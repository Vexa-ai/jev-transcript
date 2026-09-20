"""Loopback-only panel. Serves fixed assets and one meeting's evaluation log."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse,json,os,time,sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import config

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--listener-pid',type=int,default=None)
parser.add_argument('--port',type=int,default=8766)
args=parser.parse_args()
LOG=ROOT.parent/'results.jsonl'

class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.headers.get('Host') not in {f'127.0.0.1:{args.port}',f'localhost:{args.port}'}:
   self.send_error(403);return
  if self.path=='/api/state':
   results=[]
   if LOG.exists():
    for line in LOG.read_text().splitlines():
     try:results.append(json.loads(line))
     except json.JSONDecodeError:pass
   # Suppress old results superseded by revised segment text.
   latest={s['id']:s['text'] for r in results for s in r.get('segments',[])}
   results=[r for r in results if all(latest[s['id']]==s['text'] for s in r.get('segments',[]))]
   try:os.kill(args.listener_pid or int((ROOT.parent/"listener.pid").read_text()),0);running=True
   except (OSError, ValueError):running=False
   transcript={s['id']:s for r in results for s in r.get('segments',[])}
   raw_path=ROOT.parent/'transcript.jsonl'
   if raw_path.exists():
    for line in raw_path.read_text().splitlines():
     try:
      segment=json.loads(line);transcript[segment['id']]=segment
     except json.JSONDecodeError:pass
   frames=[]
   frame_path=ROOT.parent/'frames.jsonl'
   if frame_path.exists():
    for line in frame_path.read_text().splitlines():
     try:frames.append(json.loads(line))
     except json.JSONDecodeError:pass
   frame_modified=frame_path.stat().st_mtime if frame_path.exists() else 0
   raw_modified=raw_path.stat().st_mtime if raw_path.exists() else 0
   modified=LOG.stat().st_mtime if LOG.exists() else None
   body=json.dumps({'results':results,'listener_running':running,'age_seconds':time.time()-modified if modified else None,'frames':frames,'transcript':list(transcript.values()),'version':str(modified)+str(raw_modified)+str(frame_modified),'config':config.read(),'config_version':config.version(config.read())}).encode()
   content_type='application/json'
  elif self.path=='/transcript-rendering.js':
   body=(ROOT.parent/'vendor/transcript-rendering/index.js').read_bytes()
   content_type='text/javascript'
  elif self.path in ('/','/app.js','/style.css','/dashboard-transcript.js'):
   name={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/dashboard-transcript.js':'dashboard-transcript.js'}[self.path]
   body=(ROOT/'dist'/name).read_bytes()
   content_type={'/':'text/html; charset=utf-8','/app.js':'text/javascript','/style.css':'text/css','/dashboard-transcript.js':'text/javascript'}[self.path]
  else:self.send_error(404);return
  self.send_response(200)
  self.send_header('Content-Type',content_type)
  self.send_header('Cache-Control','no-store')
  self.send_header('X-Content-Type-Options','nosniff')
  self.send_header('Content-Security-Policy',"default-src 'self'; connect-src 'self'; frame-ancestors 'none'")
  self.send_header('Content-Length',str(len(body)))
  self.end_headers();self.wfile.write(body)
 def do_POST(self):
  if self.path!='/api/config':self.send_error(404);return
  if self.headers.get('Host') not in {f'127.0.0.1:{args.port}',f'localhost:{args.port}'} or self.headers.get('Origin') not in {f'http://127.0.0.1:{args.port}',f'http://localhost:{args.port}'}:
   self.send_error(403);return
  try:
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<=32000:raise ValueError('Invalid request size')
   request=json.loads(self.rfile.read(length))
   value=config.validate(request)
   temp=config.PATH.with_suffix('.tmp')
   temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(config.PATH)
   body=json.dumps({'config':value,'version':config.version(value)}).encode()
   self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
  except (ValueError,KeyError) as e:self.send_error(400,"Invalid configuration",str(e))
 def log_message(self,*a):pass

print(f'Live panel: http://127.0.0.1:{args.port}',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
