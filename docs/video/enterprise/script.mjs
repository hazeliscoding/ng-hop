// The tutorial's narration, chapter by chapter. `text` is the caption, `say` what the voice reads when it differs.
// Each chapter's visuals are in scenes/<id>.html, where data-cue="s12" brings an element in as sentence s12 starts.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const scene = (id) => { const file = join(ROOT, 'scenes', `${id}.html`); return existsSync(file) ? readFileSync(file, 'utf8') : ''; };

const css = String.raw`
      @font-face { font-family: "JetBrains Mono"; font-weight: 400; src: url("assets/fonts/jetbrains-mono-latin-400-normal.woff2") format("woff2"); }
      @font-face { font-family: "JetBrains Mono"; font-weight: 700; src: url("assets/fonts/jetbrains-mono-latin-700-normal.woff2") format("woff2"); }
      :root {
        --ground: #061717;
        --panel: #0c2423;
        --panel-2: #10302e;
        --line: #1d4a46;
        --ink: #e7f6f3;
        --muted: #8db5af;
        --teal: #2dd4bf;
        --teal-ink: #042f2e;
        --amber: #f5a524;
        --red: #f87171;
        --green: #4ade80;
        --mono: "JetBrains Mono", monospace;
        --sans: system-ui, sans-serif;
      }
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: var(--ground); }
      #root {
        position: relative; width: 100%; height: 100%; overflow: hidden;
        font-family: var(--sans); color: var(--ink);
        background: radial-gradient(1200px 700px at 85% -10%, #0f3a36 0%, transparent 60%), var(--ground);
      }
      [data-composition-id="main"] > div[data-composition-src] { position: absolute; inset: 0; }
      .scene { position: absolute; inset: 0; }
      .progress { position: absolute; left: 0; top: 0; width: 100%; height: 5px; background: var(--teal); opacity: 0.6; transform-origin: 0 50%; }
      .chapter { position: absolute; left: 96px; top: 52px; display: flex; gap: 16px; align-items: center; font-size: 28px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
      .chapter-n { display: inline-grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; background: var(--teal); color: var(--teal-ink); font-weight: 800; letter-spacing: 0; }
      .captions { position: absolute; left: 0; right: 0; bottom: 40px; height: 120px; }
      .cap { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: max-content; max-width: 1560px; margin: 0; padding: 14px 30px; border-radius: 14px; background: rgba(2, 12, 12, 0.82); font-size: 32px; line-height: 1.35; text-align: center; text-wrap: balance; }
      .panel { position: absolute; background: var(--panel); border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); }
      .term { font-family: var(--mono); font-size: 28px; line-height: 1.5; overflow: hidden; }
      .term-bar { display: flex; gap: 10px; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--line); color: var(--muted); font-family: var(--sans); font-size: 28px; }
      .term-bar .dot { width: 14px; height: 14px; border-radius: 50%; background: #2b5450; }
      .term-bar .where { margin-left: 10px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .term-body { padding: 14px 26px 20px; }
      .term-body > div { white-space: pre-wrap; }
      .you { color: var(--teal); font-weight: 700; }
      .you::before { content: "you › "; color: var(--muted); font-weight: 400; }
      .cmd { color: var(--ink); }
      .cmd::before { content: "$ "; color: var(--muted); }
      .out { color: #cfe6e2; }
      .dim { color: var(--muted); }
      .err { color: var(--red); }
      .ok { color: var(--green); }
      .warn { color: var(--amber); }
      .h1 { font-size: 84px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
      .h2 { font-size: 52px; font-weight: 750; letter-spacing: -0.01em; line-height: 1.15; }
      .lead { font-size: 36px; color: var(--muted); line-height: 1.35; }
      .card { padding: 28px 34px; font-size: 30px; line-height: 1.42; }
      .card h3 { margin: 0 0 14px; font-size: 28px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--teal); }
      .card p { margin: 0 0 10px; }
      .card ul { margin: 0; padding-left: 1.1em; }
      .card li { margin: 0 0 8px; }
      .aside { border: 2px solid var(--amber); background: #1d1a0e; }
      .aside h3 { color: var(--amber); }
      .stop { border: 2px solid var(--teal); }
      .shot { position: absolute; border-radius: 18px; overflow: hidden; border: 1px solid var(--line); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45); background: #f3f5f9; }
      .shot img { display: block; width: 100%; }
      .badge { position: absolute; padding: 8px 18px; border-radius: 999px; background: var(--teal); color: var(--teal-ink); font-weight: 800; font-size: 30px; }
      .badge.amber { background: var(--amber); color: #2a1a00; }
      .diff { font-family: var(--mono); font-size: 28px; line-height: 1.5; }
      .diff .add { color: var(--green); }
      .diff .del { color: var(--red); }
      .box { position: absolute; padding: 22px 26px; border-radius: 18px; background: var(--panel); border: 2px solid var(--line); font-size: 28px; line-height: 1.4; color: var(--muted); }
      .box b { display: block; margin-bottom: 6px; font-size: 32px; color: var(--ink); }
      .box.teal { border-color: var(--teal); }
      .box.amber { border-color: var(--amber); }
      .link { position: absolute; height: 0; border-top: 4px dashed var(--teal); }
      .link-label { position: absolute; white-space: nowrap; font-size: 28px; color: var(--teal); letter-spacing: 0.04em; }
      .ticks { list-style: none; margin: 0; padding: 0; }
      .ticks li { margin: 0 0 10px; padding-left: 1.4em; text-indent: -1.4em; }
      .ticks li::before { content: "✓ "; color: var(--green); font-weight: 800; }
      .num { display: inline-grid; place-items: center; width: 52px; height: 52px; margin-right: 18px; border-radius: 14px; background: var(--panel-2); border: 2px solid var(--teal); color: var(--teal); font-weight: 800; font-size: 28px; }
`;

export default {
  title: 'An enterprise Angular upgrade, with an agent',
  voice: 'af_heart',
  speed: 1,
  css,
  chapters: [
    {
      id: 'intro', title: 'Why this is hard',
      sentences: [
        { id: 's1', text: "This is Acme's portal, an Angular 21 app, and an AI coding agent is going to take it to Angular 22." },
        { id: 's2', text: "For most apps that's one command. This one is built on Acme's own UI libraries, and they only accept Angular 21." },
        { id: 's3', text: 'So the libraries have to move first and be published, and only then can the app follow.' },
        { id: 's4', text: "You'll see the agent run into real problems along the way, and how it handles them." },
        { id: 's5', text: "If you're new to working with an agent, watch where it stops. It plans before it changes anything, and it asks before most things that are yours to decide." },
      ],
    },
    {
      id: 'setup', title: 'The setup',
      sentences: [
        { id: 's6', text: 'The code lives in two repositories, the way a company usually splits it.' },
        { id: 's7', text: 'acme-ui holds the libraries. ui-core has the buttons, cards and design tokens, and ui-forms builds its form fields on top of ui-core.', say: 'Acme UI holds the libraries. UI core has the buttons, cards and design tokens, and UI forms builds its form fields on top of UI core.' },
        { id: 's8', text: "They're published to a private registry. At work that's something like Artifactory or GitHub Packages. Here it's Verdaccio, running locally.", say: "They're published to a private registry. At work that's something like Artifactory or GitHub Packages. Here it's Verdacho, running locally." },
        { id: 's9', text: "acme-portal is the app. It installs both libraries from that registry, and its dev container pins the team's Node version.", say: "Acme portal is the app. It installs both libraries from that registry, and its dev container pins the team's Node version." },
        { id: 's10', text: "The agent runs on Windows, on the host, not inside the container. It edits, builds and tests on the machine, and the container is where the team builds and serves." },
        { id: 's11', text: 'The agent is Claude Code, with ng-hop installed. ng-hop is a skill: instructions and scripts the agent loads when you ask about an Angular upgrade.', say: 'The agent is Claude Code, with N G hop installed. N G hop is a skill: instructions and scripts the agent loads when you ask about an Angular upgrade.' },
      ],
    },
    {
      id: 'ask', title: 'Ask, and let it plan',
      sentences: [
        { id: 's12', text: 'In the portal, the whole request is one sentence.' },
        { id: 's13', text: "The agent loads ng-hop and runs its plan first. The plan reads what's installed from the lockfile and what's published from the registry, and changes nothing.", say: "The agent loads N G hop and runs its plan first. The plan reads what's installed from the lockfile and what's published from the registry, and changes nothing." },
        { id: 's14', text: 'The answer is: not today. Both libraries only accept Angular 21.' },
        { id: 's15', text: "The plan also sees that they come from Acme's own registry, so they're most likely the team's. And it gives the order: ui-core first, because ui-forms needs it.", say: "The plan also sees that they come from Acme's own registry, so they're most likely the team's. And it gives the order: UI core first, because UI forms needs it." },
        { id: 's16', text: "So the agent stops. It hasn't touched either repository, and it recommends upgrading the libraries first, because waiting for them would only mean waiting on your own team." },
        { id: 's17', text: "If you're newer to this: a library's peer range says which Angular versions it accepts. An agent could force its way past it. That's how upgrades can break at runtime, so a good agent gives you the choice." },
        { id: 's18', text: 'If you lead a team, this is the call you want a person to make, and the agent brings the facts for it: who owns each library, what it needs, and how much the app uses it.' },
      ],
    },
    {
      id: 'libraries', title: 'The libraries go first',
      sentences: [
        { id: 's19', text: 'The reply is: yes, start with acme-ui.', say: 'The reply is: yes, start with Acme UI.' },
        { id: 's20', text: 'In the library repository, the agent creates a branch and records a starting point. Both libraries build, and their tests pass.' },
        { id: 's21', text: "It reads Angular's own update guide for 21 to 22, then runs ng update with Angular, the CLI and ng-packagr named together, so nothing has to be forced.", say: "It reads Angular's own update guide for twenty-one to twenty-two, then runs N G update with Angular, the CLI and N G packager named together, so nothing has to be forced." },
        { id: 's22', text: "Then comes the part ng update doesn't do for a library. Each library's version goes to 22.0.0, its Angular peer ranges move to the new major, and ui-forms now needs ui-core 22.", say: "Then comes the part N G update doesn't do for a library. Each library's version goes to twenty-two point zero point zero, its Angular peer ranges move to the new major, and UI forms now needs UI core twenty-two." },
        { id: 's23', text: 'It builds both, in order, runs the tests again, and commits.' },
        { id: 's24', text: "Its report puts the hand fixes first, because that's what a reviewer has to read. Then come the migrations, the scripts ng update runs to rewrite your code. One of them kept the old change detection on every component, since Angular 22 changes the default.", say: "Its report puts the hand fixes first, because that's what a reviewer has to read. Then come the migrations, the scripts N G update runs to rewrite your code. One of them kept the old change detection on every component, since Angular twenty-two changes the default." },
        { id: 's25', text: "It even read ng-packagr's changelog, and pointed out that the libraries are now bundled by a different tool, which is worth a look in the app.", say: "It even read N G packager's changelog, and pointed out that the libraries are now bundled by a different tool, which is worth a look in the app." },
        { id: 's26', text: "Then it stops again. Publishing changes what every app installs, and a version number can't be published twice." },
      ],
    },
    {
      id: 'publish', title: 'Publish, and a safeguard',
      sentences: [
        { id: 's27', text: 'Yes, publish both, then upgrade the portal.' },
        { id: 's28', text: 'Both releases go to the registry. Back in the portal, the plan now says Angular 22 is reachable, and the agent records the starting point there: the build, the test, and the app running in Chrome.' },
        { id: 's29', text: "Then ng update refuses. It still checks the old 21.4.0 releases, which only accept Angular 21, though version 22 was published a minute ago.", say: "Then N G update refuses. It still checks the old twenty-one point four releases, which only accept Angular twenty-one, though version twenty-two was published a minute ago." },
        { id: 's30', text: "The agent traces it to pnpm 12's minimum release age: a release that new needs an exemption first. It's a guard against a compromised package reaching you before anyone notices.", say: "The agent traces it to P N P M twelve's minimum release age: a release that new needs an exemption first. It's a guard against a compromised package reaching you before anyone notices." },
        { id: 's31', text: "It spots that the team already exempted the 21.4.0 releases from that rule, in pnpm's settings file, and a scratch copy of the project shows 22.0.0 needs the same.", say: "It spots that the team already exempted the twenty-one point four releases from that rule, in P N P M's settings file, and a scratch copy of the project shows twenty-two point zero needs the same." },
        { id: 's32', text: "When it tries to add the same exemption for 22.0.0, Claude Code's own safety check stops it, because that relaxes a security setting. So it asks.", say: "When it tries to add the same exemption for twenty-two point zero, Claude Code's own safety check stops it, because that relaxes a security setting. So it asks." },
        { id: 's33', text: "That's the system working. The agent can explain a safeguard, but relaxing one is a person's decision." },
      ],
    },
    {
      id: 'age', title: 'A rule inside ng update',
      sentences: [
        { id: 's34', text: 'The answer: yes, exempt the two versions, like before.' },
        { id: 's35', text: 'The exemption is committed, and ng update still refuses.', say: 'The exemption is committed, and N G update still refuses.' },
        { id: 's36', text: "This time the agent reads the Angular CLI's own source. It finds that ng update applies the age rule itself, 24 hours by default, and never reads pnpm's exemption list.", say: "This time the agent reads the Angular CLI's own source. It finds that N G update applies the age rule itself, twenty-four hours by default, and never reads P N P M's exemption list." },
        { id: 's37', text: 'It offers two ways forward: wait until tomorrow, or install the two exempted releases with pnpm first, and then run ng update for Angular.', say: 'It offers two ways forward: wait until tomorrow, or install the two exempted releases with P N P M first, and then run N G update for Angular.' },
        { id: 's38', text: "The second runs ng update on uncommitted changes, with a flag the skill normally avoids, so it says so, and asks.", say: "The second runs N G update on uncommitted changes, with a flag the skill normally avoids, so it says so, and asks." },
        { id: 's39', text: 'Go with option two.' },
        { id: 's40', text: "Now ng update's peer check sees the real 22.0.0 releases and passes, and every migration runs.", say: "Now N G update's peer check sees the real twenty-two point zero releases and passes, and every migration runs." },
        { id: 's41', text: 'The portal builds, its test passes, and the app renders in Chrome, the same as on Angular 21.' },
        { id: 's42', text: "The report lists what was done by hand, why the install order changed, and one flow it didn't exercise: submitting the request form, which is worth a click by hand." },
      ],
    },
    {
      id: 'container', title: 'Check where the team works',
      sentences: [
        { id: 's43', text: 'One line of that report was wrong. It said neither repository pins a Node version.' },
        { id: 's44', text: "Open the dev container, and the build stops. It still runs Node 22.12, which is too old for Angular 22.", say: "Open the dev container, and the build stops. It still runs Node twenty-two point twelve, which is too old for Angular twenty-two." },
        { id: 's45', text: 'Told about it, the agent says plainly that it was its mistake: it checked the library repository for Node pins, but not the portal.' },
        { id: 's46', text: "It moves the dev container to Node 22.23.4, staying on the team's Node line, and tests the image before saying it's done.", say: "It moves the dev container to Node twenty-two point twenty-three point four, staying on the team's Node line, and tests the image before saying it's done." },
        { id: 's47', text: 'Rebuilt, the container runs Node 22.23.4, builds the app, and serves it.', say: 'Rebuilt, the container runs Node twenty-two point twenty-three point four, builds the app, and serves it.' },
        { id: 's48', text: "After this run, ng-hop was updated too. Its plan now finds Node pins itself, in Dockerfiles, dev containers, version files and GitHub workflows, so next time the portal's plan names this one.", say: "After this run, N G hop was updated too. Its plan now finds Node pins itself, in Dockerfiles, dev containers, version files and GitHub workflows, so next time the portal's plan names this one." },
        { id: 's49', text: 'This is why you check the result where your team actually works, not only where the agent ran.' },
      ],
    },
    {
      id: 'takeaways', title: 'What to take away',
      hold: 2,
      sentences: [
        { id: 's50', text: 'A few habits carry over to your own upgrades.' },
        { id: 's51', text: "Ask for the plan before the change. It's cheap, and it tells you what's in the way." },
        { id: 's52', text: 'Go one major at a time, with a commit for each, so any stop is a safe place to stop.' },
        { id: 's53', text: "Read the hand fixes first. They're the parts no tool did for you." },
        { id: 's54', text: 'When your own libraries block you, they go first, and publishing is your call.' },
        { id: 's55', text: "When the agent stops to ask, that's usually the most important moment of the run." },
        { id: 's56', text: 'And check the result where your team works.' },
        { id: 's57', text: "The example is in the ng-hop repository, under examples, enterprise, if you'd like to run it yourself.", say: "The example is in the N G hop repository, under examples, enterprise, if you'd like to run it yourself." },
      ],
    },
  ].map((chapter) => ({ ...chapter, visuals: scene(chapter.id) })),
};
