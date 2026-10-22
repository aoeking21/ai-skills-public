#!/usr/bin/env python3
"""Daily READ-ONLY skills check. Writes report only; never modifies skills."""
import os, hashlib, datetime, pathlib
H = pathlib.Path.home()
SOT = H / 'ai-skills' / 'skills'
DIRS = {'codex': H/'.codex/skills', 'claude': H/'.claude/skills', 'openclaw': H/'.openclaw/skills',
        'uclaw': H/'.uclaw/data/.openclaw/skills', 'agents': H/'.agents/skills'}
OUT = H / '.local/state/skills-check'

def h(p):
    f = p / 'SKILL.md'
    return hashlib.sha256(f.read_bytes()).hexdigest()[:10] if f.is_file() else None

def main():
    unmig, broken, conf, seen = [], [], [], {}
    for surf, d in DIRS.items():
        if not d.exists(): continue
        for e in sorted(d.iterdir()):
            if e.name.startswith('.'): continue
            if e.is_symlink() and not e.exists():
                broken.append(f'{surf}: {e} -> {os.readlink(e)}'); continue
            if not (e / 'SKILL.md').is_file(): continue
            real = e.resolve()
            seen.setdefault(e.name, set()).add((str(real).replace(str(H), '~'), h(e)))
            try: real.relative_to(SOT.resolve()); ok = True
            except ValueError: ok = False
            if not ok: unmig.append(f'{surf}: {e.name} (real: {str(real).replace(str(H), "~")})')
    for n, s in sorted(seen.items()):
        if len({x[1] for x in s}) > 1:
            conf.append(f'{n}: ' + '; '.join(f'{p} [{hh}]' for p, hh in sorted(s)))
    now = datetime.datetime.now().astimezone()
    rep = [f'# Skills check {now:%Y-%m-%d %H:%M %Z}', '',
           f'- Unmigrated (real dir outside ~/ai-skills/skills): {len(unmig)}',
           f'- Broken symlinks: {len(broken)}', f'- Version conflicts: {len(conf)}', '']
    for t, l in (('Broken symlinks', broken), ('Version conflicts', conf), ('Unmigrated', unmig)):
        rep += [f'## {t}', ''] + [f'- {x}' for x in l] + ['']
    OUT.mkdir(parents=True, exist_ok=True)
    txt = '\n'.join(rep)
    (OUT / f'report-{now:%Y%m%d}.md').write_text(txt, encoding='utf-8')
    (OUT / 'latest.md').write_text(txt, encoding='utf-8')
    print(f'UNMIGRATED={len(unmig)} BROKEN={len(broken)} CONFLICTS={len(conf)}')

if __name__ == '__main__':
    main()
