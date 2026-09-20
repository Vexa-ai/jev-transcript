import json,re,hashlib
from pathlib import Path
PATH=Path(__file__).resolve().parent/'questions.json'

def validate(value):
    questions=value.get('questions') if isinstance(value,dict) else None
    if not isinstance(questions,dict) or not 1<=len(questions)<=12:
        raise ValueError('Provide 1–12 questions')
    for key,q in questions.items():
        if not re.fullmatch('[a-z][a-z0-9_]{0,39}',key):raise ValueError('Question IDs must use lowercase letters, numbers and underscores')
        if not isinstance(q,str) or not 5<=len(q.strip())<=2000:raise ValueError('Each question must contain 5–2000 characters')
    threshold=value.get('threshold',.85)
    if isinstance(threshold,bool) or not isinstance(threshold,(float,int)) or not 0<=threshold<=1:raise ValueError('Threshold must be between 0 and 1')
    prompt=value.get('prompt','')
    if not isinstance(prompt,str) or len(prompt)>8000:raise ValueError('Shared prompt must be text up to 8000 characters')
    return {'prompt':prompt.strip(),'questions':{k:q.strip() for k,q in questions.items()},'threshold':threshold}

def read():return validate(json.loads(PATH.read_text()))
def version(value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()[:10]
