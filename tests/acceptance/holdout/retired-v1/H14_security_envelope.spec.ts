import { test, expect, auth, createDiagram, document, library, startRun, waitRun, rawHTTP } from './helpers';

test('H14 [PLT-1, PLT-2, PER-1, ENG-5] exact Host, Origin and token checks reject mutations without side effects', async ({ request, token, source }) => {
  const port = process.env.HOLDOUT_PORT || '4399';
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const health = await rawHTTP('GET', '/api/health', { Host: host });
  expect(health.status).toBe(200);
  expect(JSON.parse(health.body)).toMatchObject({ ok: true, version: expect.stringMatching(/^\d+\.\d+\.\d+(?:[-+].*)?$/) });
  expect((await rawHTTP('GET', '/api/health', { Host: `localhost:${port}` })).status).toBe(200);
  for (const hostile of [`evil.example:${port}`, `127.0.0.1:${Number(port) + 1}`, `127.0.0.1:${port}.evil.example`]) {
    expect((await rawHTTP('GET', '/api/health', { Host: hostile })).status).toBe(403);
  }
  expect((await rawHTTP('GET', '/api/health', { Host: host, Origin: 'https://evil.example' })).status).toBe(403);
  const original = await createDiagram(request, token);
  const before = await library(request);
  const changed = { ...original, title: 'Unauthorised overwrite' };
  const runBody = { source, ref: null, engine: 'fixture', model: null, instruction: 'Forbidden run [fixture:fail]', diagramId: null };
  const operations: [string, string, unknown?][] = [
    ['POST', '/api/runs', runBody],
    ['POST', '/api/diagrams', changed],
    ['PUT', `/api/diagrams/${original.id}`, changed],
    ['DELETE', `/api/diagrams/${original.id}`],
    ['POST', `/api/diagrams/${original.id}/duplicate`],
  ];
  for (const [method, endpoint, body] of operations) {
    for (const badHeaders of [
      { Host: host },
      { Host: host, 'X-Archdraw-Token': `${token}-wrong` },
      { Host: host, 'X-Archdraw-Token': token, Origin: 'https://evil.example' },
      { Host: host, 'X-Archdraw-Token': token, Origin: 'null' },
      { Host: `evil.example:${port}`, 'X-Archdraw-Token': token, Origin: origin },
    ]) {
      const response = await rawHTTP(method, endpoint, badHeaders, body);
      expect(response.status, `${method} ${endpoint} rejects untrusted credentials`).toBe(403);
      expect(JSON.parse(response.body).error).toEqual(expect.any(String));
    }
  }
  expect(await document(request, original.id)).toEqual(original);
  expect(await library(request)).toEqual(before);
  const runningId = await startRun(request, token, source, 'Cancellable authorised run [fixture:slow]');
  try {
    const runningPath = `/api/runs/${runningId}`;
    for (const headers of [{ Host: host }, { Host: host, 'X-Archdraw-Token': 'wrong-token' }, { Host: host, 'X-Archdraw-Token': token, Origin: 'https://evil.example' }]) {
      expect((await rawHTTP('POST', `${runningPath}/cancel`, headers)).status).toBe(403);
      expect((await (await request.get(runningPath)).json()).status).toBe('running');
    }
    const accepted = await rawHTTP('POST', `${runningPath}/cancel`, { Host: host, 'X-Archdraw-Token': token, Origin: origin });
    expect(accepted.status).toBe(200);
    expect(JSON.parse(accepted.body)).toEqual({ ok: true });
    expect((await waitRun(request, runningId, 'cancelled')).diagramId).toBeNull();
  } finally {
    await request.post(`/api/runs/${runningId}/cancel`, { headers: auth(token) });
  }
  const authorised = await rawHTTP('PUT', `/api/diagrams/${original.id}`, { Host: host, 'X-Archdraw-Token': token, Origin: origin }, { ...original, title: 'Authorised review' });
  expect(authorised.status).toBe(200);
  expect((await document(request, original.id)).title).toBe('Authorised review');
  expect((await library(request)).map(entry => entry.id).sort()).toEqual(before.map(entry => entry.id).sort());
});
