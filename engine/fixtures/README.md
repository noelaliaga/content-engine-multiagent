# Fixtures (synthetic)

One hand-written JSON response per step, named `<step_id>.json`. They are used by the offline
provider (`npm run demo`) and by the tests. They describe the fictional Quillfern client and are
**not model output**. They are built to exercise the engine: `content_qa.json` contains one
`revise` and one `rejected` idea (a guaranteed-result claim), so the calendar has to handle both.
