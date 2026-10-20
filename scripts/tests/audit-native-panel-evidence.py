"""Independently cross-check the retained G07e panel evidence, without UI input."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CASE = ROOT / "evidence/client-native-g07e-panel6-20261020"
OUTPUT = ROOT / "evidence/client-native-g07e-panel6-root-review-20261020.json"


def read(name):
    return json.loads((CASE / name).read_text())


def main():
    result = read("probe-result.json")
    observations = result["observations"]
    deny = read("panel-deny-experience-proof.json")
    allow = read("panel-allow-experience-proof.json")
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    check("retained-driver-passed-fourteen-assertions", result["status"] == "passed" and len(result["checks"]) == 14)
    before = observations["windowsBefore"]
    extra = observations["windowsAfter"]["extra"]
    check("one-owned-main-and-one-added-panel", before["count"] == 1 and len(extra) == 1 and extra[0]["ownerPid"] == before["windows"][0]["ownerPid"])
    check("ax-panel-frame-matches-windowserver", observations["axPanel"]["element"]["frame"] == extra[0]["bounds"])
    check("both-accessibility-grants-were-observed", observations["accessibility"] == {"axTrusted": True, "syntheticKeyAccess": True})
    outcomes = {entry["case"]: entry for entry in observations["panelInteraction"]["outcomes"]}
    check("cancel-produced-zero-chips", outcomes["cancel"]["chipCount"] == 0 and outcomes["cancel"]["panelClosed"])
    check("deny-and-allow-selected-one-file-and-closed-panel", all(outcomes[name]["chipCount"] == 1 and outcomes[name]["panelClosed"] for name in ("deny", "allow")))
    marker = (ROOT / "data/client-native-g07e-panel6-20261020/project-g07e/attachment-allow.txt").read_text().strip()
    check("fixture-marker-is-nonempty", len(marker) > 20)
    deny_hits = [i for i, request in enumerate(deny["modelRequests"]) if marker in json.dumps(request)]
    allow_hits = [i for i, request in enumerate(allow["modelRequests"]) if marker in json.dumps(request)]
    check("withheld-body-and-allow-body-match-supplier-records", deny_hits == [] and allow_hits == [4] and outcomes["deny"]["markerRequests"] == deny_hits and outcomes["allow"]["markerRequests"] == allow_hits)
    check("allow-retains-all-prior-deny-requests", allow["modelRequests"][:len(deny["modelRequests"])] == deny["modelRequests"])
    check("supplier-counts-match-retained-ledger-sizes", all(proof["modelCalls"] == len(proof["modelRequests"]) == len(proof["ledger"]) for proof in (deny, allow)))
    check("five-unique-settlements-total-110-credit", len({row["id"] for row in allow["ledger"]}) == 5 and all(row["status"] == "settled" for row in allow["ledger"]) and sum(row["amount"] for row in allow["ledger"]) == 110)
    journal = observations["axJournal"]
    check("both-files-accepted-by-real-row-actions", {entry["case"] for entry in journal if entry["step"] == "open-row" and entry["codes"]["AXConfirm"] == 0} == {"deny", "allow"})
    check("teardown-observed-zero-owned-windows", observations["windowsAfterTeardown"]["count"] == 0)
    files = ["probe-result.json", "panel-deny-experience-proof.json", "panel-allow-experience-proof.json", "ax-tree-panel.json", "ax-tree-panel-folder.json"]
    output = {
        "schema": "uwork.native-panel.retained-evidence-review.v1",
        "status": "passed",
        "scope": "Root independent read-only review of retained panel6 evidence; no new browser, keyboard, OS panel or business execution",
        "checks": checks,
        "sourceSha256": {name: hashlib.sha256((CASE / name).read_bytes()).hexdigest() for name in files},
        "supplierCalls": allow["modelCalls"],
        "settledCredit": sum(row["amount"] for row in allow["ledger"]),
        "formalSourceLockGoActorAcceptance": "not executed; remains open",
        "cleanupBoundary": "retained driver observed zero owned windows; historical PID identity/port closure not independently reconstructed by this review",
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": output["status"], "checks": len(checks), "output": str(OUTPUT)}))


if __name__ == "__main__":
    main()
