import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTutorialPrompt, experiments, initialSelection, palettes, resolveSelection, setupCommands } from '../src/tutorial.ts';

test('every selection carries the chosen palette, matched hypothesis, and complete source rows', () => {
  for (const palette of palettes) {
    for (const experiment of experiments) {
      for (const hypothesis of experiment.hypotheses) {
        const prompt = buildTutorialPrompt({ paletteId: palette.id, experimentId: experiment.id, hypothesisId: hypothesis.id });
        assert.ok(prompt.includes(`Question: ${experiment.question}`));
        assert.ok(prompt.includes(`Hypothesis: ${hypothesis.label}`));
        assert.ok(prompt.includes(`Palette: ${palette.label}`));
        assert.ok(prompt.includes(palette.colors.join(', ')));
        assert.ok(prompt.includes(experiment.dataset));
        assert.ok(prompt.includes(experiment.method));
        for (const other of experiments.filter((item) => item.id !== experiment.id)) assert.ok(!prompt.includes(other.dataset));
      }
    }
  }
});

test('cross-question hypotheses and unknown choices are rejected', () => {
  for (const patch of [{ hypothesisId: 'mugs' }, { paletteId: 'unlisted' }, { experimentId: 'unlisted' }, { hypothesisId: '' }]) {
    assert.throws(() => resolveSelection({ ...initialSelection, ...patch }), /matching hypothesis/);
  }
});

test('the synthetic rows support an honest positive and negative hypothesis for each question', () => {
  const packing = experiments.find((item) => item.id === 'packing');
  const rows = packing.dataset.split('\n').slice(1).map((line) => line.split(','));
  const mean = (batch) => {
    const values = rows.filter((row) => row[1] === batch).map((row) => Number(row[2]));
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  assert.equal(mean('A'), 12);
  assert.equal(mean('B'), 9);
  const reduction = (mean('A') - mean('B')) / mean('A') * 100;
  assert.ok(reduction >= 20);
  assert.ok(!(reduction >= 40));

  const shelf = experiments.find((item) => item.id === 'shelf');
  const shares = shelf.dataset.split('\n').slice(1).map((line) => {
    const [product, starting, sold] = line.split(',');
    return { product, share: Number(sold) / Number(starting) };
  }).sort((a, b) => b.share - a.share);
  assert.equal(shares[0].product, 'Prints');
  assert.equal(shares[0].share, 0.8);
  assert.notEqual(shares[0].product, 'Mugs');
});

test('all generated prompts retain setup evidence and execution boundaries', () => {
  for (const experiment of experiments) {
    const prompt = buildTutorialPrompt({ ...initialSelection, experimentId: experiment.id, hypothesisId: experiment.hypotheses[0].id });
    for (const required of [
      'runtimeReady: false', 'does not start workers or grant execution authority',
      'Do not claim that Trellis executed this report', 'private',
      'There is no published npm install package', 'exact Git revision',
      'Do not report installation success without command evidence',
      'Cross-harness runtime acceptance is not established',
      'tutorial-output/report.html', 'tutorial-output/evidence.md',
      'If either file exists, stop and ask before replacement',
      'Synthetic tutorial data', 'no scripts, no remote assets',
      'Do not invent sources, research, observations, or missing data',
      'Do not perform external research', 'spend money', 'write to GitHub',
      'Do not start workers or request action approvals',
    ]) assert.ok(prompt.includes(required), `Missing boundary: ${required}`);
    assert.ok(prompt.includes(setupCommands));
  }
  assert.match(setupCommands, /git clone --branch feature\/trellis-v1 https:\/\/github.com\/sageadvicellc\/trellis.git/);
  assert.match(setupCommands, /npm ci --ignore-scripts\nnpm run build/);
  assert.match(setupCommands, /validate examples\/endor\/crew.yaml/);
});
