/** Bounded workspace transfer and Git maintenance inside the container. @module */

/** Trusted controller; repository bytes never select a host command or pathname. */
export const WORKSPACE_CONTROLLER = String.raw`
import os, sys, json, stat, base64, subprocess, hashlib, posixpath
ROOT='/workspace'
r=json.load(sys.stdin)
LIMIT=r['maxBytes']; COUNT=r['maxEntries']; TIMEOUT=r['timeoutSeconds']
env={'PATH':'/usr/bin:/bin','HOME':'/tmp','LANG':'C.UTF-8','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0','GIT_AUTHOR_NAME':r['authorName'],'GIT_AUTHOR_EMAIL':r['authorEmail'],'GIT_COMMITTER_NAME':r['authorName'],'GIT_COMMITTER_EMAIL':r['authorEmail']}
def git(*args, data=None):
    p=subprocess.run(['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgsign=false','-c','protocol.allow=never',*args], cwd=ROOT, env=env, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=TIMEOUT)
    if p.returncode: raise ValueError('workspace Git operation failed: '+p.stderr[:2048].decode('utf-8','replace'))
    if len(p.stdout)>LIMIT: raise ValueError('workspace Git output limit exceeded')
    return p.stdout

def path(name):
    if not isinstance(name,str) or not name or name.startswith('/') or '\\' in name or '\x00' in name or any(p in ('','.','..') for p in name.split('/')): raise ValueError('invalid workspace entry path')
    return ROOT+'/'+name

def link_ok(name, target):
    if target.startswith('/') or '\\' in target or '\x00' in target: raise ValueError('absolute or invalid workspace symlink')
    resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),target))
    if resolved=='..' or resolved.startswith('../'): raise ValueError('escaping workspace symlink')

def capture():
    entries=[]; size=0
    def visit(directory):
        nonlocal size
        for name in sorted(os.listdir(directory)):
            full=directory+'/'+name; rel=os.path.relpath(full,ROOT); info=os.lstat(full)
            if len(entries)>=COUNT: raise ValueError('workspace entry limit exceeded')
            if stat.S_ISLNK(info.st_mode):
                target=os.readlink(full); link_ok(rel,target)
                resolved=os.path.realpath(full, strict=True)
                if os.path.commonpath((ROOT,resolved))!=ROOT: raise ValueError('escaping workspace symlink chain')
                entry={'path':rel,'kind':'link','data':target,'mode':0}
                size+=len(target.encode())
            elif stat.S_ISDIR(info.st_mode): entry={'path':rel,'kind':'directory','data':'','mode':info.st_mode & 0o777}
            elif stat.S_ISREG(info.st_mode):
                if info.st_size+size>LIMIT: raise ValueError('workspace byte limit exceeded')
                fd=os.open(full,os.O_RDONLY|os.O_NOFOLLOW)
                with os.fdopen(fd,'rb') as f: data=f.read(LIMIT-size+1)
                if len(data)+size>LIMIT: raise ValueError('workspace byte limit exceeded')
                size+=len(data); entry={'path':rel,'kind':'file','data':base64.b64encode(data).decode(),'mode':info.st_mode & 0o777}
            else: raise ValueError('special workspace file is unsupported: '+rel)
            entries.append(entry)
            if entry['kind']=='directory': visit(full)
    visit(ROOT)
    return {'entries':entries}

def restore(entries):
    if os.listdir(ROOT): raise ValueError('restore requires an empty workspace')
    if len(entries)>COUNT: raise ValueError('workspace entry limit exceeded')
    seen=set(); size=0
    for e in entries:
        full=path(e['path'])
        if e['path'] in seen: raise ValueError('duplicate workspace path')
        seen.add(e['path'])
        parent=os.path.dirname(full)
        if os.path.realpath(parent)!=parent: raise ValueError('symlink parent in workspace archive')
        if e['kind']=='directory': os.mkdir(full,0o700)
        elif e['kind']=='link':
            link_ok(e['path'],e['data']); os.symlink(e['data'],full)
        elif e['kind']=='file':
            data=base64.b64decode(e['data'],validate=True); size+=len(data)
            if size>LIMIT: raise ValueError('workspace byte limit exceeded')
            fd=os.open(full,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb') as f: f.write(data)
            os.chmod(full,e['mode'] & 0o777)
        else: raise ValueError('invalid workspace entry kind')
    return {}

def maintain():
    for special in ('.git','.git/objects','.git/refs'):
        if not stat.S_ISDIR(os.lstat(path(special)).st_mode): raise ValueError('workspace Git directory was replaced')
    for special in ('.git/config','.git/objects/info/alternates','.git/info/grafts'):
        full=path(special)
        if os.path.lexists(full) and not stat.S_ISREG(os.lstat(full).st_mode): raise ValueError('unsafe Git metadata')
        if special!='.git/config' and os.path.exists(full): raise ValueError('external Git object sources are unsupported')
    config=path('.git/config'); original=open(config,'rb').read() if os.path.exists(config) else None
    with open(config,'wb') as f: f.write(b'[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = true\n')
    try:
        op=r['operation']
        if op=='prepare':
            if any(os.path.lexists(path('.git/'+name)) for name in ('MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply')): raise ValueError('finish the in-progress Git operation before saving')
            if git('ls-files','-u'): raise ValueError('unmerged changes require resolution before saving')
            git('add','--all','--','.')
            tree=git('write-tree').decode().strip(); parent=git('rev-parse','HEAD').decode().strip()
            clean=tree==git('rev-parse','HEAD^{tree}').decode().strip()
            diff=git('diff','--cached','--no-ext-diff','--no-textconv','--stat').decode('utf-8','replace')
            summary=git('diff','--no-ext-diff','--no-textconv','--stat',r['baseline']).decode('utf-8','replace')
            return {'tree':tree,'parent':parent,'clean':clean,'diff':diff,'summary':summary}
        if op=='commit':
            env['GIT_AUTHOR_DATE']=r['timestamp']; env['GIT_COMMITTER_DATE']=r['timestamp']
            oid=git('commit-tree',r['tree'],'-p',r['parent'],data=r['message'].encode()).decode().strip()
            current=git('rev-parse','HEAD').decode().strip()
            if current!=oid: git('update-ref','HEAD',oid,r['parent'])
            return {'oid':oid}
        if op=='bundle':
            refs=git('for-each-ref','--format=%(refname) %(objectname)','refs/heads/').decode().splitlines()
            heads={line.split(' ')[0]:line.split(' ')[1] for line in refs}
            heads['HEAD']=git('rev-parse','HEAD').decode().strip()
            data=git('bundle','create','-','--branches','HEAD')
            return {'heads':heads,'bundle':base64.b64encode(data).decode()}
        raise ValueError('unknown workspace maintenance operation')
    finally:
        if original is None: os.unlink(config)
        else:
            with open(config,'wb') as f: f.write(original)
try:
    op=r['operation']
    value=restore(r['entries']) if op=='restore' else capture() if op=='capture' else maintain()
    output=json.dumps({'ok':True,'value':value},separators=(',',':'))
    if len(output.encode())>r['maxOutputBytes']: raise ValueError('workspace response limit exceeded')
    print(output)
except Exception as e:
    print(json.dumps({'ok':False,'error':str(e)[:2048]}))
`
