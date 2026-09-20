# Jev transcript
Live Vexa transcripts annotated with Jev: signal emojis, entity classes, keyword highlights and word significance.

A standalone local prototype, not a deployed Vexa feature. The browser shows drafts immediately, then attaches Jev results to confirmed segments. No generative model rewrites the text.

## Start
Requires Python 3.11+, uv, Node.js and npm.

```sh
uv sync
npm ci
npm run build:transcript
export OPENROUTER_API_KEY='your-key'
export VEXA_API_KEY='your-key'
uv run python run.py vexa --platform google_meet --meeting-id YOUR-MEETING-ID
```

In a second terminal, from this repository:
```sh
uv run python panel/server.py
```
Open http://127.0.0.1:8766/. A Vexa bot must already be present in the meeting, and the key must have transcript access. This application does not dispatch bots. Stop the processes with Ctrl+C.

Use **Prompt & questions** to change signal questions and the display threshold during processing. Changes apply to the next evaluation. Hover displays saved results, without additional model calls.

## Processing
- The listener consumes Vexa WebSocket events. The existing transcript-rendering package handles draft/confirmed merging, ordering and retractions in the browser.
- YAKE proposes up to eight literal keyword candidates, with explicit numeric candidates. Jev assigns relevance and person/company/data/product/other classifications.
- Jev scores signal questions and distinct words in the same request. Word opacity is clamped to 0.05–1. Scores are model judgments, not measured accuracy.
- Evaluations preserve source segment IDs, exact text, model route, questions, configuration version and latency.
- Annotation matching uses segment ID plus exact evaluated text. The prototype scores distinct word strings per segment, not individual repeated occurrences.

Default route: `typesafe/jev-1.13` through the OpenRouter alpha decisions endpoint. For direct access, pass `--provider typesafe` and set `TYPESAFE_API_KEY`.

## Local output and privacy
Credentials are read only from environment variables. No personal credential loader is included. Source text and configured questions are sent to the selected hosted model provider.

Runtime files are ignored by Git:
- `results.jsonl`: evaluations and original text
- `transcript.jsonl`: confirmed source segments
- `frames.jsonl`: incoming transcript frames
- `listener.pid`: local listener PID

Use one meeting per working directory. Archive or remove old runtime files before using a different meeting. The panel binds to loopback only. It is a development viewer, not an authenticated hosted application.

## Validation
```sh
uv run python -m unittest -v
uv run python live.py --dry-run --output smoke.jsonl replay sample.json --speed 20
```
The fixture is synthetic. Tests cover protocol and result handling, not model accuracy. The CLI also supports timestamp-paced YouTube caption replay for offline experiments; live meeting mode uses Vexa transcription.

## Limitations
WebSocket reconnect and bounded transient API retries are implemented, but reconnect gap backfill and durable processing checkpoints are not. Annotations are not reprocessed automatically when questions change. Context is limited to 24 preceding segments and a 60,000-character serialized-state guard; this is not tokenizer-based budgeting. Per-word questions increase request size.

The panel polls full local logs, so memory and transfer grow with the meeting. It is not a production stream-processing service. Entity extraction, cleanup, inference calibration and production-scale delivery require further evaluation. Jev does not generate explanations or corrected transcripts.

## Code
- `live.py`: ingestion and Jev processing
- `config.py`, `questions.json`: editable configuration
- `panel/server.py`: local API and asset server
- `panel/src/transcript.tsx`: annotated transcript UI
- `vendor/transcript-rendering`: existing Apache-2.0 Vexa renderer, vendored unchanged

Apache-2.0. See LICENSE and NOTICE.

References: [Jev API](https://docs.typesafe.ai/introduction/quickstart), [Vexa](https://github.com/Vexa-ai/vexa).
