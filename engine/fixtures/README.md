# Fixtures (synthetic)

One hand-written JSON response per step, named `<step_id>.json`. They are used by the offline
provider (`npm run demo`) and by the tests. They describe the fictional Quillfern client and are
**not model output**. They are built to exercise the engine: `content_qa.json` contains one
`revise` idea and one `rejected` idea. The rejected one (`idea_08`) makes a guaranteed-result claim:
its average (3.0) alone would only mean `revise`, and it is rejected by the engine's claim-safety rule
(`claim_safety <= 1`), which shows up as an adjustment in `state.json`. The calendar has to handle both.
