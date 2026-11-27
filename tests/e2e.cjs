/*
 * Test end-to-end di bitescape.html nel browser (Chromium headless, Playwright).
 *
 *   python3 -m http.server 8095        # dalla cartella del repository
 *   node tests/e2e.cjs                 # oppure: BASE_URL=https://... node tests/e2e.cjs
 */
const path = require("path");
const fs = require("fs");

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  console.error("Playwright non trovato: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const URL = (process.env.BASE_URL || "http://localhost:8095/") + "bitescape.html";
const SHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log("  ✔ " + msg); } else { failed++; console.log("  ✘ " + msg); } };

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const G = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + ".png") });
  const state = () => G(() => JSON.parse(JSON.stringify(window.StarshipGame.gameState)));

  console.log("Apertura " + URL);
  await page.goto(URL);
  await page.waitForFunction(() => window.StarshipGame && window.StarshipGame.ready, null, { timeout: 40000 });
  await page.waitForTimeout(800);
  await shot("01-inizio");

  console.log("Domande e risposte");
  check(await G(() => !!window.AFRAME && AFRAME.version.startsWith("1.7")), "A-Frame 1.7 caricato dalla cartella vendor/");
  const okMapping = await G(() => window.StarshipGame.activeQuestions.every((q) => {
    const orig = QUESTION_POOL.find((p) => p.question === q.question);
    return orig && q.options[q.correct] === orig.options[orig.correct] && q.options.length === 3;
  }));
  check(okMapping, "dopo il mescolamento la risposta giusta resta quella corretta");
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    (await G(() => window.StarshipGame.activeQuestions.map((q) => q.correct))).forEach((c) => seen.add(c));
    await G(() => window.StarshipGame.resetGame(true));
  }
  check(seen.has(0) && seen.has(1) && seen.has(2), "la risposta giusta compare in posizione A, B e C (non sempre A)");
  check(await G(() => !document.getElementById("btn-screen-new-mission").classList.contains("clickable")),
    "il pulsante «nuova missione» dietro la serranda non è cliccabile prima della vittoria");

  console.log("Avvio e quiz su PC");
  await page.click("#btn-start");
  await page.waitForTimeout(600);
  check((await state()).started, "«Inizia Missione» avvia la partita");
  check(await page.isVisible("#pc-hud"), "HUD visibile");

  // clic reale del mouse sul cristallo del NODO 01
  const pt = await G(() => {
    const v = new THREE.Vector3();
    document.getElementById("crystal-hit-0").object3D.getWorldPosition(v);
    v.project(document.querySelector("a-scene").camera);
    const r = document.querySelector("canvas.a-canvas").getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, ok: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 };
  });
  check(pt.ok, "il cristallo del NODO 01 è inquadrato");
  await page.mouse.move(pt.x, pt.y, { steps: 3 });
  await page.waitForTimeout(100);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(500);
  check(await page.isVisible("#desktop-quiz-modal"), "clic sul cristallo → si apre la domanda");
  check(await G(() => document.getElementById("player-camera").getAttribute("wasd-controls").enabled === false), "con la domanda aperta WASD è disattivato");

  const correct0 = await G(() => window.StarshipGame.activeQuestions[0].correct);
  const wrongKey = String(((correct0 + 1) % 3) + 1);
  await page.keyboard.press(wrongKey);
  await page.waitForTimeout(300);
  let s = await state();
  check(!s.solved[0] && /Suggerimento|Risposta errata/.test(await page.textContent("#dt-feedback")), "tasto con risposta sbagliata → errore e suggerimento");
  await shot("02-risposta-errata");
  await page.keyboard.press(String(correct0 + 1));
  await page.waitForTimeout(300);
  s = await state();
  check(s.solved[0] && s.combo === 2, "tasto con risposta giusta → nodo risolto, combo x2");
  await G(() => window.StarshipGame.openQuizForModule(5));
  check(await G(() => window.StarshipGame.gameState.activeModuleIndex === 0), "nei 2 secondi di chiusura non si apre un altro nodo");
  await page.waitForTimeout(2300);
  check(!(await page.isVisible("#desktop-quiz-modal")), "la finestra si chiude da sola dopo 2 secondi");
  check(await G(() => document.getElementById("label-0").getAttribute("neon-label").text.includes("ATTIVO")), "etichetta del nodo diventa [ATTIVO]");

  console.log("Gran finale");
  await G(() => {
    const S = window.StarshipGame;
    for (let i = 1; i < 10; i++) { S.openQuizForModule(i); S.submitAnswer(S.activeQuestions[i].correct); if (i < 9) S.closeQuizPanel(); }
  });
  await page.waitForTimeout(2500);
  await shot("03-raggi");
  check(await G(() => document.getElementById("victory-beams").children.length === 10), "10 raggi di luce dai cristalli");
  check(await G(() => document.querySelectorAll("[id^=glass-seal-]").length === 10), "10 cilindri di vetro attorno alle gemme");
  await page.waitForTimeout(4500);
  await shot("04-maxischermo");
  check(await G(() => document.getElementById("shutter-gate").object3D.position.y > 5.5), "la serranda si è sollevata");
  check(await G(() => document.querySelector("a-scene").components["starship-vfx"].confettiOn), "coriandoli attivi");
  check(await G(() => document.getElementById("victory-ceiling-leds").children.length === 16), "LED sul soffitto accesi");
  check(await G(() => document.getElementById("btn-screen-new-mission").classList.contains("clickable")), "pulsante «nuova missione» attivo");
  await page.waitForTimeout(3000);
  await shot("05-fuochi");
  check(await G(() => document.querySelector("a-scene").components["starship-vfx"].alive === 1), "fuochi d'artificio in corso");

  console.log("Nuova missione");
  await G(() => document.getElementById("btn-screen-new-mission").emit("click"));
  await page.waitForTimeout(500);
  s = await state();
  check(!s.started && !s.completed && s.solved.every((x) => !x), "stato azzerato");
  check(await page.isVisible("#start-overlay"), "torna la schermata iniziale");
  check(await G(() => Math.abs(document.getElementById("shutter-gate").object3D.position.y - 1.9) < 1e-6 && document.getElementById("victory-beams").children.length === 0),
    "serranda chiusa e raggi rimossi");

  console.log("VR simulata");
  await G(() => { const sc = document.querySelector("a-scene"); sc.addState("vr-mode"); sc.emit("enter-vr"); });
  await page.waitForTimeout(400);
  check(await G(() => document.getElementById("vr-start-panel").object3D.visible), "in VR compare il pannello «Inizia missione»");
  await G(() => document.getElementById("vr-start-button").emit("click"));
  await page.waitForTimeout(300);
  check((await state()).started, "il pulsante 3D avvia la partita");
  check(await G(() => document.getElementById("vr-control-bar").object3D.visible), "in VR ci sono i comandi AUDIO e RIAVVIA");
  await G(() => window.StarshipGame.openQuizForModule(4));
  await page.waitForTimeout(400);
  check(await G(() => {
    const panel = document.getElementById("quiz-panel-vr");
    return panel.object3D.visible && panel.parentElement.tagName === "A-SCENE" && document.getElementById("opt-bg-0").classList.contains("clickable");
  }), "pannello domande in VR ancorato nel mondo, con risposte puntabili");
  await shot("06-vr-domanda");
  const c4 = await G(() => window.StarshipGame.activeQuestions[4].correct);
  await G((c) => document.getElementById("opt-bg-" + c).emit("click"), c4);
  check((await state()).solved[4], "grilletto sulla risposta giusta → nodo risolto");
  await G(() => { const sc = document.querySelector("a-scene"); sc.removeState("vr-mode"); sc.emit("exit-vr"); });

  console.log("Audio");
  await page.click("#btn-audio-toggle");
  check(await G(() => window.audioEngine ? true : true) && (await page.textContent("#btn-audio-toggle")).includes("OFF"), "AUDIO: OFF");
  await page.click("#btn-audio-toggle");
  check((await page.textContent("#btn-audio-toggle")).includes("ON"), "AUDIO: ON");

  check(errors.length === 0, "nessun errore JavaScript" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passed} verifiche superate, ${failed} fallite.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
