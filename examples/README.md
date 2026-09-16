# Example run (synthetic)

`example__mock/` is the output of `npm run example`: the offline pipeline run on the fictional
**Quillfern Plant Co.** client with the hand-written fixtures in `engine/fixtures/`.

- **No model produced this.** Every JSON file comes from a fixture that went through the real
  pipeline code (JSON parsing, JSON Schema validation, cross-step checks, normalisation).
- Open `example__mock/dashboard.html` in a browser to see the run viewer. It loads nothing from the network.
- Timestamps in `state.json` are frozen with `--now 2030-01-02T03:04:05.000Z`, so regenerating
  the example gives byte-identical files unless the code or fixtures change.

Regenerate with `npm run example`.
