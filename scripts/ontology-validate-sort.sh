#!/usr/bin/env bash
# Pre-commit hook: validate + deterministically sort Turtle ontology files.
# Pure Python (rdflib) — no Jena container, no OpenJDK required.
# Auto-installs rdflib into a project-local venv on first run.
#
# Usage: scripts/ontology-validate-sort.sh <file.ttl> [more.ttl ...]

set -euo pipefail

VENV="${PWD}/.ontology-hook-venv"
PYTHON="${VENV}/bin/python"

if [ ! -x "${PYTHON}" ]; then
    echo "ontology-validate-sort: creating venv ${VENV}"
    python3 -m venv "${VENV}"
    "${VENV}/bin/pip" install --quiet rdflib
fi

"${PYTHON}" - "${@}" << 'PYEOF'
import sys
from rdflib import Graph

failures = 0
for path in sys.argv[1:]:
    try:
        g = Graph()
        g.parse(path, format="turtle")
    except Exception as e:
        print(f"ontology-validate-sort: FAILED to parse {path}: {e}")
        failures += 1
        continue

    expected = "\n".join(
        f"<{s}> <{p}> {o.n3()} ."
        for s, p, o in sorted(
            g.triples((None, None, None)),
            key=lambda t: (str(t[0]), str(t[1]), str(t[2])),
        )
    ) + "\n"

    with open(path) as f:
        actual = f.read()

    if actual != expected:
        print(f"ontology-validate-sort: {path} is not sorted. Run:")
        print(f"  {sys.executable} -c \"from rdflib import Graph; "
              f"g=Graph(); g.parse('{path}', format='turtle'); "
              f"open('{path}','w').write('\\n'.join(f'<{{s}}> <{{p}}> {{o.n3()}} .' "
              f"for s,p,o in sorted(g.triples((None,None,None)), "
              f"key=lambda t:(str(t[0]),str(t[1]),str(t[2]))))+'\\n')\"")
        failures += 1

if failures:
    sys.exit(1)
print(f"ontology-validate-sort: OK ({len(sys.argv)-1} file(s))")
PYEOF
