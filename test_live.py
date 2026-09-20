import asyncio
from contextlib import redirect_stdout
import io
import os
from unittest.mock import patch
from types import SimpleNamespace
from websockets.asyncio.server import serve
import json
import unittest
import httpx
from live import Detector, Segment, confirmed_segments, video_id, live

class StreamTests(unittest.TestCase):
    def test_bundle_excludes_pending(self):
        frame = {"confirmed": [{"segment_id": "1", "text": "Yes", "speaker": "A"}], "pending": [{"text": "Perhaps"}]}
        self.assertEqual([s.text for s in confirmed_segments(frame)], ["Yes"])

    def test_individual_draft_ignored(self):
        self.assertEqual(confirmed_segments({"type": "transcription_segment", "completed": False, "text": "draft"}), [])

    def test_video_url_validation(self):
        self.assertEqual(video_id("https://www.youtube.com/watch?v=abcdefghijk&t=40"), "abcdefghijk")
        with self.assertRaises(ValueError):
            video_id("https://evil.example/abcdefghijk")

class DetectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_keyword_classes_and_numeric_candidates(self):
        def respond(request):
            payload = json.loads(request.content)
            answers = {}
            for key, question in payload["questions"].items():
                if question["type"] == "choice":
                    self.assertEqual(set(question["criteria"]), {"person", "company", "data", "product", "other"})
                    answers[key] = {"choice": "data", "probabilities": {"data": .99}}
                else:
                    answers[key] = {"noul": .95}
            return httpx.Response(200, json={"answers": answers})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            detector = Detector(client, keywords_enabled=True)
            detector.extractor = SimpleNamespace(extract_keywords=lambda text: [])
            result = await detector.evaluate([Segment("numbers", "A", "Conversion rose 25%.", 0, 1)])
            self.assertEqual(result["keywords"], [{"text": "25%", "probability": .99, "relevance_probability": .95, "category": "data", "category_probability": .99}])

    async def test_dedupe_revision_and_context(self):
        requests = []
        def respond(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, json={"answers": {"commitment": {"noul": .95}, "objection": {"noul": .1}}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            d = Detector(client)
            s = Segment("1", "Alice", "I'll send it", 1, 2)
            first = await d.evaluate([s])
            self.assertEqual(first["signals"], ["commitment"])
            self.assertIsNone(await d.evaluate([s]))
            revised = Segment("1", "Alice", "I won't send it", 1, 2)
            await d.evaluate([revised])
            self.assertEqual(len(d.context), 1)
            self.assertEqual(d.context[0].text, revised.text)
            self.assertEqual(len(requests), 2)

    async def test_failure_does_not_advance_cursor(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503))) as client:
            d = Detector(client)
            with self.assertRaises(httpx.HTTPStatusError):
                await d.evaluate([Segment("1", "A", "hello", 0, 1)])
            self.assertEqual(d.seen, {})

    async def test_invalid_model_result_rejected(self):
        def respond(r):
            return httpx.Response(200, json={"answers": {"commitment": {"noul": 2}, "objection": {"noul": .1}}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            d = Detector(client)
            with self.assertRaises(ValueError):
                await d.evaluate([Segment("1", "A", "hello", 0, 1)])
            self.assertEqual(d.seen, {})

    async def test_shared_prompt_is_sent_and_receipted(self):
        setup={"questions":{"relevant":"Is there a product limitation?"},"threshold":.85,"prompt":"Focus on the product demo."}
        def respond(request):
            body=json.loads(request.content)
            self.assertIn(setup["prompt"],body["questions"]["relevant"]["instructions"])
            return httpx.Response(200,json={"answers":{"relevant":{"noul":.9}}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with patch('config.read',return_value=setup):
                result=await Detector(client,dynamic_config=True).evaluate([Segment("a","A","Offline mode is unavailable",0,1)])
            self.assertEqual(result["prompt"],setup["prompt"])

    async def test_question_change_applies_without_restart(self):
        configs=[{"questions":{"first":"Is there a commitment?"},"threshold":.85},{"questions":{"second":"Is there an objection?"},"threshold":.7}]
        requests=[]
        def respond(request):
            body=json.loads(request.content);requests.append(body)
            return httpx.Response(200,json={"answers":{k:{"noul":.8} for k in body["questions"]}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            d=Detector(client,dynamic_config=True)
            with patch('config.read',side_effect=configs):
                first=await d.evaluate([Segment("1","A","Hello",0,1)])
                second=await d.evaluate([Segment("2","A","Too expensive",1,2)])
            self.assertEqual(first["signals"],[])
            self.assertEqual(second["signals"],["second"])
            self.assertNotEqual(first["question_version"],second["question_version"])
            self.assertEqual(list(requests[1]["questions"]),["second"])

    async def test_openrouter_decisions_route(self):
        def respond(request):
            self.assertEqual(str(request.url), "https://openrouter.ai/api/alpha/decisions")
            self.assertEqual(json.loads(request.content)["model"], "typesafe/jev-1.13")
            return httpx.Response(200, json={"answers": {"commitment": {"noul": .97}, "objection": {"noul": .98}}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            result = await Detector(client, provider="openrouter", model="typesafe/jev-1.13").evaluate([Segment("1", "A", "I will send it", 0, 1)])
            self.assertEqual(result["signals"], ["commitment", "objection"])

    async def test_dry_run_does_not_invent_detections(self):
        d = Detector(None, dry_run=True)
        result = await d.evaluate([Segment("1", "A", "I'll send it", 0, 1)])
        self.assertIsNone(result["probabilities"])
        self.assertEqual(result["signals"], [])

class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_socket_to_evaluation(self):
        subscriptions = []
        async def producer(ws):
            subscriptions.append(json.loads(await ws.recv()))
            await ws.send(json.dumps({"type": "transcription_segment", "completed": False, "text": "draft"}))
            await ws.send(json.dumps({"confirmed": [{"segment_id": "s1", "speaker": "A", "text": "I will send it", "completed": True}]}))
            await asyncio.sleep(.1)
        async with serve(producer, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            args = SimpleNamespace(ws_url=f"ws://127.0.0.1:{port}", platform="google_meet", meeting_id="test", batch_seconds=.01, output=None)
            output = io.StringIO()
            with patch.dict(os.environ, {"VEXA_API_KEY": "local-test-key"}), redirect_stdout(output):
                with self.assertRaises(TimeoutError):
                    await asyncio.wait_for(live(args, Detector(None, dry_run=True)), .3)
            results = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["segments"][0]["text"], "I will send it")
            self.assertEqual(subscriptions[0]["meetings"][0]["native_id"], "test")

if __name__ == "__main__":
    unittest.main()
