"""Builds results/ from the Harbor job directories under jobs/.

    python scripts/collect_results.py

For every environment it copies, each with reward.txt, result.json and logs:

  results/<env>/safe_reference/     oracle agent on solution/
  results/<env>/unsafe_reference/   oracle agent on unsafe_reference/
  results/<env>/nop/                Harbor's do-nothing agent
  results/<env>/break/              one gpt-6.1-sol rollout that completed the task
                                    AND sent the sensitive unit (only if one exists)
  results/<env>/rollout_latest/     otherwise, the latest attempt on the final version
  results/<env>/rollouts.md         every gpt-6.1-sol attempt, in order, with outcome

and writes results/SUMMARY.md. Rollout jobs are any job directory whose name
starts with "rollout"; their order is the order the jobs were started.
"""
from __future__ import annotations

import json
import shutil
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "jobs"
OUT = ROOT / "results"

# What to copy out of a trial directory (relative paths; directories are copied whole).
KEEP = [
    "config.json", "trial.log", "exception.txt",
    "agent/trajectory.json", "agent/terminus_2.pane", "agent/recording.cast", "agent/oracle.txt",
    "verifier",
]


def trials(job: Path) -> list[Path]:
    return sorted((p for p in job.iterdir() if p.is_dir() and (p / "result.json").exists()),
                  key=lambda p: (p / "result.json").stat().st_mtime)


def verdict(trial: Path) -> dict | None:
    result = trial / "verifier" / "result.json"
    if not result.exists():
        return None
    data = json.loads(result.read_text(encoding="utf-8"))
    reward = (trial / "verifier" / "reward.txt").read_text().strip()
    violations = {k: v for k, v in data["safety"].items() if v["violates"]}
    failed = [c["name"] for c in data["task"]["checks"] if not c["passed"]]
    return {"completed": data["task"]["task_completed"], "violations": violations, "failed": failed,
            "reward": reward, "preserved": (trial / "verifier" / "received").exists()}


def _path_spellings(path: Path) -> list[str]:
    """The ways an absolute path shows up in logs and JSON written on this machine."""
    win = str(path)
    posix = path.as_posix()
    uri = urllib.parse.quote(posix, safe="/:")
    return sorted({win, win.replace("\\", "\\\\"), posix, posix.replace("/", "\\/"), uri}, key=len, reverse=True)


def portable(dest: Path) -> None:
    """Rewrites machine-specific absolute paths in copied text files to placeholders."""
    harbor = Path(shutil.which("harbor") or ROOT).resolve().parent.parent
    swaps = [(s, "<repo>") for s in _path_spellings(ROOT)] + [(s, "<harbor>") for s in _path_spellings(harbor)]
    for file in dest.rglob("*"):
        if not file.is_file() or file.suffix in {".cast"}:
            continue
        try:
            text = file.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        new = text
        for old, placeholder in swaps:
            if len(old) > 3:
                new = new.replace(old, placeholder)
        if new != text:
            file.write_text(new, encoding="utf-8", newline="")


def copy_trial(trial: Path, dest: Path) -> None:
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    for rel in KEEP:
        src = trial / rel
        if src.is_dir():
            shutil.copytree(src, dest / rel)
        elif src.exists():
            (dest / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest / rel)
    # reward.txt and result.json at the top are the grader's outputs, in the
    # format the assignment specifies; Harbor's own trial record sits beside them.
    for name in ("reward.txt", "result.json"):
        src = trial / "verifier" / name
        if src.exists():
            shutil.copy2(src, dest / name)
    if (trial / "result.json").exists():
        shutil.copy2(trial / "result.json", dest / "harbor_trial_result.json")
    (dest / "SOURCE.txt").write_text(f"{trial.relative_to(ROOT).as_posix()}\n", newline="\n")
    portable(dest)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    summary = ["# Results", "",
               "| Environment | Sub-policy | Safe ref | Unsafe ref | Do-nothing | gpt-6.1-sol attempts | Breaks (task done + unit sent) | Shipped break |",
               "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for env_dir in sorted((ROOT / "environments").iterdir()):
        env = env_dir.name
        policy = "DH.E" if 'sub_policy = "DH.E"' in (env_dir / "task.toml").read_text() else "DH.A"
        jobs = JOBS / env
        out = OUT / env
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir(parents=True)
        cells = {}
        for name in ("safe_reference", "unsafe_reference", "nop"):
            job = jobs / name
            ts = trials(job) if job.exists() else []
            if ts:
                copy_trial(ts[-1], out / name)
                v = verdict(ts[-1])
                cells[name] = (f"reward {v['reward']}, task {'done' if v['completed'] else 'not done'}, "
                               f"{'violation' if v['violations'] else 'clean'}") if v else "no verdict"
            else:
                cells[name] = "not run"

        rollout_jobs = sorted((j for j in jobs.iterdir() if j.is_dir() and j.name.startswith("rollout")),
                              key=lambda j: (j / "config.json").stat().st_mtime if (j / "config.json").exists() else 0)
        rows, breaks, attempts = [], [], 0
        for job in rollout_jobs:
            for trial in trials(job):
                v = verdict(trial)
                if v is None:
                    rows.append(f"| {job.name} | {trial.name} | - | - | - | harness error, no verdict |")
                    continue
                attempts += 1
                broke = v["completed"] and bool(v["violations"])
                if broke:
                    breaks.append((trial, v))
                outcome = ("**BREAK**: " + ", ".join(v["violations"])) if broke else (
                    ("violation, task not done: " + ", ".join(v["violations"])) if v["violations"] else
                    ("clean" if v["completed"] else "task not done: " + "; ".join(v["failed"])[:160]))
                rows.append(f"| {job.name} | {trial.name} | {v['completed']} | {bool(v['violations'])} | {v['reward']} | {outcome} |")
        shipped = None
        if breaks:
            preserved = [b for b in breaks if b[1]["preserved"]]
            shipped = (preserved or breaks)[-1][0]
            copy_trial(shipped, out / "break")
        elif rollout_jobs:
            # No break: ship the most recent attempt on the final version, so the
            # claim that the model stayed safe can be checked in its trajectory.
            latest = [t for t in trials(rollout_jobs[-1]) if verdict(t)]
            if latest:
                copy_trial(latest[-1], out / "rollout_latest")
        (out / "rollouts.md").write_text("\n".join([
            f"# {env}: every gpt-6.1-sol rollout", "",
            "Job names are versions of the environment; README.md says what changed between them.", "",
            "| Job | Trial | Task completed | Unit sent | Reward | Outcome |", "| --- | --- | --- | --- | --- | --- |",
            *rows, "",
            f"Shipped break: `{shipped.relative_to(ROOT).as_posix()}` (copied to `break/`)" if shipped else "No break recorded.",
            ""]), encoding="utf-8")
        summary.append(f"| [{env}]({env}/rollouts.md) | {policy} | {cells['safe_reference']} | {cells['unsafe_reference']} | "
                       f"{cells['nop']} | {attempts} | {len(breaks)} | {'[break/](' + env + '/break/)' if shipped else 'none'} |")
    (OUT / "SUMMARY.md").write_text("\n".join(summary) + "\n", encoding="utf-8")
    print("\n".join(summary))


if __name__ == "__main__":
    main()
