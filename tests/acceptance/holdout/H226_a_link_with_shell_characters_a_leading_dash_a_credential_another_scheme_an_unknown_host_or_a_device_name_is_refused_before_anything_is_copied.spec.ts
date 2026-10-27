import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists } from './helpers';
import { jobServer, makeRemote, reposListing, activityOf } from './helpers-jobs';

const NOT_A_LINK = 'Not a repository link';
const CREDENTIALS = 'Leave the user name and password out of the link';
const HOSTS = 'Only github.com, gitlab.com and bitbucket.org links can be drawn';
const GIVE = 'Give the link of a repository';

// SRC-4, START-4 (api contract, *Reading a link*, in the order of its checks; AGENTS.md invariant 1 and its "A link reaching git as an option"
// trap): a link is refused with a 400, by `POST /api/folders/check` and by `POST /api/scans` alike, before git runs: another scheme or transport,
// the `git@` form, a port, shell characters, a leading `-` or `.`, a Windows device name, a branch that breaks the rule, a user name or
// password, a host other than the three. Nothing is copied, no scan starts, and a link that is fine is read as the contract says.
test('H226 [SRC-4 START-4 #199] a link with shell characters, a leading dash, a credential, another scheme, an unknown host or a Windows device name is refused with the contracted sentence before anything is copied or started', async () => {
  test.setTimeout(180_000);
  const server = await jobServer({ remotes: true, stepMs: 100 });
  try {
    await makeRemote(server, 'github.com/acme/shop'); // a link to it is fine; none below reaches it
    const marker = join(await gitRepo('link-injection').then(r => r.dir), 'pwned');
    const long = (n: number) => 'a'.repeat(n);
    const cases: [unknown, string][] = [
      // 1. Given but not a link at all.
      ['   ', GIVE], ['', GIVE], [42, GIVE], [true, GIVE], [{}, GIVE], [['https://github.com/acme/shop'], GIVE],
      // 2. Another scheme or transport, the `git@` form, a port, too long, an option for git.
      ['http://github.com/acme/shop', NOT_A_LINK], ['ssh://git@github.com/acme/shop', NOT_A_LINK], ['git://github.com/acme/shop', NOT_A_LINK],
      ['file:///etc/passwd', NOT_A_LINK], [`ext::sh -c "touch ${marker}"`, NOT_A_LINK], [`ext::sh -c touch ${marker}`, NOT_A_LINK],
      ['git@github.com:acme/shop.git', NOT_A_LINK], ['https://github.com:8443/acme/shop', NOT_A_LINK],
      ['ssh://user@example.com/a/b', NOT_A_LINK],
      [`https://github.com/acme/${long(300)}`, NOT_A_LINK],
      // 3. A user name or password, before the host is looked at.
      ['https://user@github.com/acme/shop', CREDENTIALS], ['https://user:secret@github.com/acme/shop', CREDENTIALS],
      ['https://:secret@github.com/acme/shop', CREDENTIALS], ['https://user@example.com/acme/shop', CREDENTIALS],
      // 4. A host other than the three, before the path is looked at.
      ['https://example.com/acme/shop', HOSTS], ['https://github.com.evil.com/acme/shop', HOSTS], ['https://evilgithub.com/acme/shop', HOSTS],
      ['https://notgitlab.com/acme/shop', HOSTS], ['https://example.com/-x/y', HOSTS], ['https://localhost/acme/shop', HOSTS], ['https://127.0.0.1/acme/shop', HOSTS],
      // 5. The path: shell characters, a leading `-` or `.`, a trailing `.`, a device name, a length, a branch that breaks the rule, the wrong shape.
      ['https://github.com/acme/shop;touch x', NOT_A_LINK], ['https://github.com/acme/shop$(touch x)', NOT_A_LINK], ['https://github.com/acme/shop`id`', NOT_A_LINK],
      ['https://github.com/acme/sh op', NOT_A_LINK], ['https://github.com/acme/shop&&id', NOT_A_LINK], ['https://github.com/acme/shop|id', NOT_A_LINK],
      ['https://github.com/acme/shop%0Aid', NOT_A_LINK], ['https://github.com/acme/shop"', NOT_A_LINK], ['https://github.com/acme/shop\\..\\x', NOT_A_LINK],
      ['https://github.com/-x/y', NOT_A_LINK], ['https://github.com/acme/-y', NOT_A_LINK], ['https://github.com/.hidden/shop', NOT_A_LINK],
      ['https://github.com/acme/.hidden', NOT_A_LINK], ['https://github.com/acme/shop.', NOT_A_LINK], ['https://github.com/acme./shop', NOT_A_LINK],
      ['https://github.com/acme/con', NOT_A_LINK], ['https://github.com/acme/NUL', NOT_A_LINK], ['https://github.com/acme/com1', NOT_A_LINK],
      ['https://github.com/acme/lpt9.txt', NOT_A_LINK], ['https://github.com/AUX/shop', NOT_A_LINK], ['https://github.com/acme/con.git', NOT_A_LINK],
      [`https://github.com/${long(101)}/shop`, NOT_A_LINK], [`https://github.com/acme/${long(101)}`, NOT_A_LINK],
      ['https://github.com/acme', NOT_A_LINK], ['https://github.com/', NOT_A_LINK], ['https://github.com/acme/shop/issues/3', NOT_A_LINK],
      ['https://github.com/acme/shop/tree', NOT_A_LINK], ['https://gitlab.com/group/sub/repo', NOT_A_LINK],
      ['https://gitlab.com/acme/shop/tree/main', NOT_A_LINK], ['https://bitbucket.org/acme/shop/tree/main', NOT_A_LINK],
      ['https://github.com/acme/shop/tree/-x', NOT_A_LINK], ['https://github.com/acme/shop/tree/a..b', NOT_A_LINK], ['https://github.com/acme/shop/tree/a//b', NOT_A_LINK],
      ['https://github.com/acme/shop/tree/x.lock', NOT_A_LINK], ['https://github.com/acme/shop/tree/x.', NOT_A_LINK], ['https://github.com/acme/shop/tree/.x', NOT_A_LINK],
      ['https://github.com/acme/shop/tree/--upload-pack=x', NOT_A_LINK], [`https://github.com/acme/shop/tree/${long(201)}`, NOT_A_LINK],
    ];
    for (const [link, error] of cases) {
      const checked = await server.post('/api/folders/check', { link });
      expect(checked, `check ${JSON.stringify(link).slice(0, 90)}`).toEqual({ status: 400, body: { error } });
      const scanned = await server.post('/api/scans', { link, engine: 'fixture', model: null });
      expect(scanned, `scan ${JSON.stringify(link).slice(0, 90)}`).toEqual({ status: 400, body: { error } });
    }

    // A text that is an option for git, not a link: refused whichever sentence says why (the contract orders the checks, not this garbage).
    for (const link of ['-x', '--help', `--upload-pack=touch ${marker}`, '--upload-pack=touch x', '-c core.sshCommand=touch x']) {
      for (const answer of [await server.post('/api/folders/check', { link }), await server.post('/api/scans', { link, engine: 'fixture', model: null })]) {
        expect(answer.status, link).toBe(400); expect(typeof answer.body.error, link).toBe('string'); expect(answer.body.error.length, link).toBeGreaterThan(0);
      }
    }

    // A link and a folder together are refused first, whatever the link says; a null folder is no folder.
    const folder = (await gitRepo('link-and-folder')).dir;
    expect(await server.post('/api/folders/check', { folder, link: 'https://github.com/acme/shop' })).toEqual({ status: 400, body: { error: 'Give a folder or a link, not both' } });
    expect(await server.post('/api/scans', { folder, link: 'ssh://nowhere', engine: 'fixture', model: null })).toEqual({ status: 400, body: { error: 'Give a folder or a link, not both' } });
    expect((await server.post('/api/folders/check', { folder: null, link: 'https://github.com/acme/shop' })).status).toBe(200);
    expect(await server.post('/api/folders/check', { link: null })).toEqual({ status: 400, body: { error: 'Give the absolute path of a folder' } });

    // What is fine is read as the contract says: the host's own branch form, the link lower-cased, nothing copied.
    const fine: [string, { link: string; branch: string | null }][] = [
      ['https://gitlab.com/Acme/Shop/-/tree/dev', { link: 'gitlab.com/acme/shop', branch: 'dev' }],
      ['https://bitbucket.org/acme/shop/src/dev', { link: 'bitbucket.org/acme/shop', branch: 'dev' }],
      ['https://github.com/acme/shop/tree/feature/pay', { link: 'github.com/acme/shop', branch: 'feature/pay' }],
      ['https://github.com/acme/shop/tree/main/src', { link: 'github.com/acme/shop', branch: 'main/src' }], // a folder of a branch is a branch that does not exist
      ['https://www.github.com/acme/my.repo_2.git', { link: 'github.com/acme/my.repo_2', branch: null }],
    ];
    for (const [link, expected] of fine) {
      const checked = await server.post('/api/folders/check', { link });
      expect(checked.status, `${link}: ${JSON.stringify(checked.body)}`).toBe(200);
      expect(checked.body).toMatchObject({ ...expected, copied: false, git: false, drawing: null });
    }

    // Must not have happened: anything copied, started or written for a link that was refused or only read.
    expect(await reposListing(server)).toEqual({ copies: [], partial: [] });
    expect(await exists(join(server.data, 'repos', 'github.com', 'acme')), 'no copy folder').toBe(false);
    expect((await activityOf(server)).jobs, 'no scan was started').toEqual([]);
    expect(await exists(marker), 'no command of the link ran').toBe(false);
    expect(await exists(join(server.data, 'sources.json')), 'no use of a folder was recorded').toBe(false);
  } finally { await server.stop(); }
});
