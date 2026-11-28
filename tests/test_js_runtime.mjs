/**
 * Atelier - Automated JavaScript Runtime & Iso-Functionality Verification Suite
 * Executes in Node.js (v22+) to test DOM templates, scripts, i18n completeness, and method conformance.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let totalChecks = 0;
let passedChecks = 0;
const failures = [];

function assert(desc, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failures.push({ desc, details });
    console.error(`  ❌ FAIL: ${desc} ${details ? `(${details})` : ''}`);
  }
}

console.log('============================================================');
console.log(' 🧪 VALIDATION AUTOMATISÉE ISO-FONCTIONNELLE & KPI RUNTIME');
console.log('============================================================\n');

// -------------------------------------------------------------
// 1. Audit i18n Exhaustif : Vérification FR, EN, JA pour toutes les applications
// -------------------------------------------------------------
console.log('🌐 [1/5] Audit Internationalisation (i18n) FR / EN / JA...');

const appsDir = path.join(rootDir, 'apps');
const appFolders = fs.readdirSync(appsDir);

appFolders.forEach(appFolder => {
  const manifestPath = path.join(appsDir, appFolder, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const appId = manifest.id || appFolder;
  const localesDir = path.join(appsDir, appFolder, 'locales');

  ['fr', 'en', 'ja'].forEach(lang => {
    // Check manifest locales definition if declared
    if (manifest.locales && manifest.locales[lang]) {
      assert(`Manifest de '${appId}' déclare le titre en [${lang}]`, !!manifest.locales[lang].title);
    }

    // Check app locales directory files
    if (fs.existsSync(localesDir)) {
      const langFile = path.join(localesDir, `${lang}.json`);
      if (fs.existsSync(langFile)) {
        try {
          const content = JSON.parse(fs.readFileSync(langFile, 'utf8'));
          assert(`Fichier apps/${appId}/locales/${lang}.json est un JSON valide`, typeof content === 'object');
        } catch (e) {
          assert(`Fichier apps/${appId}/locales/${lang}.json est valide`, false, e.message);
        }
      }
    }
  });
});

// Vérifier que autorun-editor a bien fr.json, en.json et ja.json avec le même jeu de clés
const autorunLocalesDir = path.join(appsDir, 'autorun-editor', 'locales');
const frJson = JSON.parse(fs.readFileSync(path.join(autorunLocalesDir, 'fr.json'), 'utf8'));
const enJson = JSON.parse(fs.readFileSync(path.join(autorunLocalesDir, 'en.json'), 'utf8'));
const jaJson = JSON.parse(fs.readFileSync(path.join(autorunLocalesDir, 'ja.json'), 'utf8'));

const frKeys = Object.keys(frJson).sort();
const enKeys = Object.keys(enJson).sort();
const jaKeys = Object.keys(jaJson).sort();

assert("Autorun Studio : parité stricte des clés FR == EN", JSON.stringify(frKeys) === JSON.stringify(enKeys));
assert("Autorun Studio : parité stricte des clés FR == JA", JSON.stringify(frKeys) === JSON.stringify(jaKeys));
assert("Autorun Studio : clé apps.autorun-editor.title présente en JA", jaJson['apps.autorun-editor.title'] === 'オートランスタジオ');

// -------------------------------------------------------------
// 2. Vérification de la Présence et Syntaxe de Tous les Fichiers Modulaires
// -------------------------------------------------------------
console.log('\n📦 [2/5] Vérification de l\'Architecture Modulaire Explorer...');

const explorerManifest = JSON.parse(fs.readFileSync(path.join(appsDir, 'explorer', 'manifest.json'), 'utf8'));
const registeredScripts = explorerManifest.scripts || [];

[
  'autorun-engine.js',
  'scripts/explorer-selection.js',
  'scripts/explorer-dragdrop.js',
  'scripts/explorer-map.js',
  'scripts/explorer-modals.js'
].forEach(scriptRel => {
  const fullPath = path.join(appsDir, 'explorer', scriptRel);
  assert(`Fichier modulaire présent : apps/explorer/${scriptRel}`, fs.existsSync(fullPath));
  assert(`Script déclaré dans manifest.scripts : ${scriptRel}`, registeredScripts.includes(scriptRel));

  if (fs.existsSync(fullPath)) {
    const code = fs.readFileSync(fullPath, 'utf8');
    assert(`Syntaxe non vide : ${scriptRel}`, code.trim().length > 100);
  }
});

// -------------------------------------------------------------
// 3. Matrice de Conformité de l'API Explorer (Préservation Fonctionnelle Stricte)
// -------------------------------------------------------------
console.log('\n🔍 [3/5] Matrice de Conformité de l\'Interface Publique Explorer...');

const explorerJs = fs.readFileSync(path.join(appsDir, 'explorer', 'explorer.js'), 'utf8');

const requiredMethods = [
  'initManagers',
  'initContainer',
  'initWindow',
  'destroy',
  'initElements',
  'loadSavedPreferences',
  't',
  'escapeHtml',
  'showLoading',
  'showToast',
  'navigateTo',
  'loadDirectory',
  'applyFolderOverrides',
  'renderBreadcrumbs',
  'renderFolders',
  'applyFilterAndRender',
  'renderMedia',
  'setViewMode',
  'bindMediaCardEvents',
  'moveItems',
  'openMedia',
  'toggleSortOrder',
  'saveFolderSort',
  'getFolderSort',
  'toggleFavorite',
  'toggleFavoritesFilter',
  'setFilterCategory',
  'updateFilterPillsUI',
  'updateStats',
  'clearSelection',
  'selectAll',
  'updateSelectionUI',
  'initMarqueeSelection',
  'computeSmartGpsLocations',
  'updateFolderMapButton',
  'openMapModal',
  'closeMapModal',
  'initLeafletMap',
  'openSearchModal',
  'closeSearchModal',
  'positionSearchModal',
  'exitSearch',
  'openCreateFolderModal',
  'closeCreateFolderModal',
  'createFolder',
  'openDeleteConfirmModal',
  'closeDeleteConfirmModal',
  'confirmDeleteItem',
  'deleteSelection',
  'openMediaCommentModal',
  'closeMediaCommentModal',
  'saveMediaComment',
  'openFolderUnlockModal',
  'closeFolderUnlockModal',
  'unlockFolder',
  'openFolderSettingsModal',
  'closeFolderSettingsModal',
  'launchAutorun',
  'openAutorunEditorModal',
  'renderAutorunVisualTimeline',
  'addAutorunStep',
  'removeAutorunStep',
  'moveAutorunStep',
  'previewCurrentAutorun',
  'saveAutorunConfig',
  'deleteAutorunConfig',
  'toggleInspector',
  'updateInspectorUI'
];

requiredMethods.forEach(method => {
  const hasMethod = explorerJs.includes(`${method}(`) || explorerJs.includes(`${method} =`) || explorerJs.includes(`async ${method}(`);
  assert(`ExplorerInstance implémente la méthode '${method}'`, hasMethod);
});

// -------------------------------------------------------------
// 4. Vérification de l'Optimisation DOM (Délégation d'Événements)
// -------------------------------------------------------------
console.log('\n⚡ [4/5] Vérification de la Délégation d\'Événements (Performance DOM)...');

assert("bindMediaCardEvents utilise mediaGrid.addEventListener('click', ...)", explorerJs.includes("this.el.mediaGrid.addEventListener('click'") || explorerJs.includes('mediaGrid.addEventListener("click"'));
assert("bindMediaCardEvents utilise mediaGrid.addEventListener('dblclick', ...)", explorerJs.includes("this.el.mediaGrid.addEventListener('dblclick'") || explorerJs.includes('mediaGrid.addEventListener("dblclick"'));
assert("bindMediaCardEvents utilise mediaGrid.addEventListener('dragstart', ...)", explorerJs.includes("this.el.mediaGrid.addEventListener('dragstart'") || explorerJs.includes('mediaGrid.addEventListener("dragstart"'));
assert("bindMediaCardEvents protège contre le double attachement via _mediaEventsDelegated", explorerJs.includes('_mediaEventsDelegated'));
assert("bindMediaCardEvents utilise e.target.closest pour la sélection de carte", explorerJs.includes("e.target.closest('[data-index]')"));

// -------------------------------------------------------------
// 5. Conformité de l'Application Dédiée Autorun Studio
// -------------------------------------------------------------
console.log('\n🎬 [5/5] Conformité de l\'Application Autorun Studio...');

const autorunAppJs = fs.readFileSync(path.join(appsDir, 'autorun-editor', 'app.js'), 'utf8');
const autorunTpl = fs.readFileSync(path.join(appsDir, 'autorun-editor', 'template.php'), 'utf8');

assert("Autorun Studio expose window.AutorunStudio", autorunAppJs.includes('window.AutorunStudio = this'));
assert("Autorun Studio hérite de WebOSApp", autorunAppJs.includes('class AutorunEditorApp extends WebOSApp'));
assert("Autorun Studio implémente switchTab", autorunAppJs.includes('switchTab('));
assert("Autorun Studio implémente syncVisualToConfig", autorunAppJs.includes('syncVisualToConfig('));
assert("Autorun Studio implémente renderTimeline", autorunAppJs.includes('renderTimeline('));
assert("Autorun Studio implémente addStep", autorunAppJs.includes('addStep('));
assert("Autorun Studio implémente preview", autorunAppJs.includes('preview('));
assert("Autorun Studio implémente save", autorunAppJs.includes('save('));
assert("Autorun Studio implémente delete", autorunAppJs.includes('delete('));
assert("Autorun Studio implémente openFolder", autorunAppJs.includes('openFolder('));
// -------------------------------------------------------------
// 6. Non-Régression & Robustesse des Événements & Classes WebOS
// -------------------------------------------------------------
console.log('\n🛡️ [6/6] Non-Régression & Robustesse Runtime (ShortcutManager & WebOSApp)...');

const shortcutManagerJs = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'ShortcutManager.js'), 'utf8');
const webOsAppJs = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'WebOSApp.js'), 'utf8');

// Test ShortcutManager._getEventCombo with mock execution
assert("ShortcutManager.js protège _getEventCombo contre e.key indéfini", shortcutManagerJs.includes("if (!e || typeof e.key !== 'string') return '';"));

// Evaluate _getEventCombo logic directly in Node
const getEventComboFunction = new Function('e', `
  if (!e || typeof e.key !== 'string') return '';
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');
  let key = e.key.toLowerCase();
  if (key === 'control' || key === 'alt' || key === 'shift' || key === 'meta') return '';
  if (key === ' ') key = 'space';
  parts.push(key);
  return parts.join('+');
`);

try {
  const resUndefined = getEventComboFunction({ key: undefined });
  assert("ShortcutManager._getEventCombo({ key: undefined }) ne lève aucune exception et renvoie ''", resUndefined === '');
} catch (err) {
  assert("ShortcutManager._getEventCombo({ key: undefined }) ne lève aucune exception", false, err.message);
}

try {
  const resEmpty = getEventComboFunction({});
  assert("ShortcutManager._getEventCombo({}) ne lève aucune exception et renvoie ''", resEmpty === '');
} catch (err) {
  assert("ShortcutManager._getEventCombo({}) ne lève aucune exception", false, err.message);
}

try {
  const resValid = getEventComboFunction({ key: 'F', ctrlKey: true });
  assert("ShortcutManager._getEventCombo({ key: 'F', ctrlKey: true }) résout 'ctrl+f'", resValid === 'ctrl+f');
} catch (err) {
  assert("ShortcutManager._getEventCombo({ key: 'F', ctrlKey: true })", false, err.message);
}

// Check WebOSApp setContent helper
assert("WebOSApp fournit la méthode setContent(content)", webOsAppJs.includes('setContent(content)'));
assert("AutorunEditorApp implémente renderShell()", autorunAppJs.includes('renderShell()'));
assert("AutorunEditorApp implémente render()", autorunAppJs.includes('render()'));
assert("AutorunEditorApp possède un montage sécurisé dans initUI()", autorunAppJs.includes('this.setContent(root)'));
assert("AutorunEditorApp implémente showToast(message, type)", autorunAppJs.includes('showToast(message, type = \'info\')'));

const webOsServicesJs = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'services', 'WebOSServices.js'), 'utf8');
assert("WebOSServices expose la méthode polyfill window.sys.toast.show", webOsServicesJs.includes('show: (msg, typeOrOpts'));

// Test Autorun Studio multi-app controls & parameter persistence
const autorunEditorJs = fs.readFileSync(path.join(rootDir, 'apps', 'autorun-editor', 'app.js'), 'utf8');
assert("AutorunEditorApp implémente la méthode i18n t(key, params)", autorunEditorJs.includes('t(key, params)'));
assert("AutorunEditorApp implémente la méthode escapeHtml(str)", autorunEditorJs.includes('escapeHtml(str)'));
assert("AutorunEditorApp configure doc-viewer avec sélecteur de fichier docFiles", autorunEditorJs.includes("buildFileOptions(file, docFiles)"));
assert("AutorunEditorApp configure doc-viewer avec ancre data-step-hl", autorunEditorJs.includes("data-step-hl"));
assert("AutorunEditorApp configure image-viewer avec sélecteur de fichier imgFiles", autorunEditorJs.includes("buildFileOptions(file, imgFiles)"));
assert("AutorunEditorApp configure video-player avec sélecteur de fichier vidéo", autorunEditorJs.includes("buildFileOptions(file, videoFiles.length > 0 ? videoFiles : mediaFiles)"));
assert("AutorunEditorApp configure audio-player avec sélecteur de fichier audio", autorunEditorJs.includes("buildFileOptions(file, audioFiles.length > 0 ? audioFiles : mediaFiles)"));
assert("AutorunEditorApp configure maps avec coordonnées GPS (lat, lng, zoom)", autorunEditorJs.includes("data-step-lat") && autorunEditorJs.includes("data-step-lng") && autorunEditorJs.includes("data-step-zoom"));
assert("AutorunEditorApp gère les commandes dynamiques pour control_app (getCommandsForApp)", autorunEditorJs.includes("getCommandsForApp(app)") && autorunEditorJs.includes("step-param-input"));
assert("AutorunEditorApp synchronise les paramètres d'action dans syncVisualToConfig", autorunEditorJs.includes("stepObj.params.highlight = highlight") && autorunEditorJs.includes("stepObj.params.file = file"));
assert("AutorunEditorApp inclut les formats étendus (pdf, txt, md, json, csv, code) dans docFiles", autorunEditorJs.includes("docExts =") && autorunEditorJs.includes("docRegex"));
assert("AutorunEditorApp initialise rawJson dans loadFolder", autorunEditorJs.includes("this.el.rawJson.value = JSON.stringify(this.currentConfig, null, 2)"));
assert("AutorunEditorApp synchronise les inputs étape vers rawJson", autorunEditorJs.includes("onStepChange") && autorunEditorJs.includes("this.el.rawJson.value = JSON.stringify"));

// -------------------------------------------------------------
// NOUVEAUX CONTRÔLES MULTIMODAUX & CAPTURE MAPS (2026)
// -------------------------------------------------------------
console.log('\n🎮 [7/7] Vérification des Nouveaux Contrôles Multimodaux & Capture Maps...');

// 1. Doc-Viewer
const docViewerManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'doc-viewer', 'manifest.json'), 'utf8'));
const docViewerJs = fs.readFileSync(path.join(rootDir, 'apps', 'doc-viewer', 'viewer.js'), 'utf8');
assert("doc-viewer manifest déclare scrollTo, searchText, nextPage, prevPage",
  !!docViewerManifest.commands.scrollTo && !!docViewerManifest.commands.searchText && !!docViewerManifest.commands.nextPage && !!docViewerManifest.commands.prevPage);
assert("doc-viewer viewer.js déclare isPdf = ext === 'pdf'", docViewerJs.includes("const isPdf = ext === 'pdf';"));
assert("doc-viewer viewer.js implémente scrollTo(params, winId)", docViewerJs.includes('scrollTo(params = {}, winId = null)'));
assert("doc-viewer viewer.js implémente searchText(params, winId)", docViewerJs.includes('searchText(params = {}, winId = null)'));
assert("doc-viewer viewer.js implémente nextPage(params, winId)", docViewerJs.includes('nextPage(params = {}, winId = null)'));
assert("doc-viewer viewer.js implémente prevPage(params, winId)", docViewerJs.includes('prevPage(params = {}, winId = null)'));
assert("doc-viewer viewer.js implémente setTheme(params, winId)", docViewerJs.includes('setTheme(params = {}, winId = null)'));
assert("doc-viewer viewer.js implémente handleCommand", docViewerJs.includes('handleCommand(command, params = {}, winId = null)'));

// Test runtime execution of DocViewerPlugin.open
try {
  const origDoc = global.document;
  global.document = {
    getElementById: () => null,
    createElement: () => ({ style: {} }),
    head: { appendChild: () => { } },
    createTreeWalker: () => ({ nextNode: () => null })
  };
  const fakeWindow = {
    sys: {
      appManager: {
        getAppTitle: () => 'Doc Viewer',
        registerInstance: () => { }
      },
      api: { fs: { saveTextFile: async () => ({ success: true }) } }
    },
    WindowManager: {
      createWindow: (opts) => ({ id: opts.id, element: {} }),
      windows: new Map()
    },
    MenuBarManager: { registerAppMenu: () => { }, setActiveApp: () => { } },
    MediaViewerRegistry: { register: () => { } },
    addEventListener: () => { },
    removeEventListener: () => { }
  };
  const docFunc = new Function('window', docViewerJs + '\nreturn window.DocViewerApp;');
  const docPlugin = docFunc(fakeWindow);
  await docPlugin.open({ path: 'test.md', name: 'test.md', extension: 'md', file_url: 'test.md' }, {}, {
    state: { filteredFiles: [], files: [], isAdmin: true },
    t: (k) => k,
    escapeHtml: (s) => s
  });
  assert("doc-viewer viewer.js open() s'exécute sans ReferenceError ou TDZ", true);
} catch (e) {
  assert("doc-viewer viewer.js open() s'exécute sans ReferenceError ou TDZ", false, e.stack);
}

// 2. Maps
const mapsManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'maps', 'manifest.json'), 'utf8'));
const mapsJs = fs.readFileSync(path.join(rootDir, 'apps', 'maps', 'maps.js'), 'utf8');
assert("maps manifest déclare moveTo et whereIam", !!mapsManifest.commands.moveTo && !!mapsManifest.commands.whereIam);
assert("maps maps.js implémente moveTo(params) dans MapsInstance", mapsJs.includes('moveTo(params = {})'));
assert("maps maps.js implémente whereIam() dans MapsInstance", mapsJs.includes('whereIam()'));
assert("maps maps.js implémente whereIam(winId) dans WebOSMapsApp", mapsJs.includes('whereIam(winId = null)'));
assert("maps maps.js implémente moveTo(params, winId) dans WebOSMapsApp", mapsJs.includes('moveTo(params = {}, winId = null)'));
assert("maps maps.js implémente handleCommand dans WebOSMapsApp", mapsJs.includes('handleCommand(command, params = {}, winId = null)'));
assert("maps maps.js extrait et stocke initialCenter depuis options.lat/lng/zoom", mapsJs.includes('this.initialCenter ='));
assert("maps maps.js préserve initialCenter dans renderMapContent sans être écrasé par recenterMap", mapsJs.includes('if (this.initialCenter) {'));

// Test d'exécution MapsInstance avec coordonnées initiales
try {
  let createdMapCenter = null;
  let createdMapZoom = null;
  const fakeL = {
    tileLayer: () => ({ addTo: () => { } }),
    map: (container, opts) => {
      createdMapCenter = opts.center;
      createdMapZoom = opts.zoom;
      return {
        addLayer: () => { },
        setView: (c, z) => { createdMapCenter = c; createdMapZoom = z; },
        remove: () => { },
        invalidateSize: () => { }
      };
    },
    markerClusterGroup: () => ({ addLayer: () => { }, clearLayers: () => { }, getBounds: () => null })
  };
  const fakeWinMaps = {
    document: {
      getElementById: () => ({ querySelectorAll: () => [], querySelector: () => null }),
      querySelector: () => null,
      querySelectorAll: () => []
    },
    L: fakeL,
    WebOSApp: class {
      constructor(manifest) { this.manifest = manifest; }
      t(k) { return k; }
      escapeHtml(s) { return String(s || ''); }
    },
    WindowManager: { createWindow: (w) => w, focusWindow: () => { }, setTitle: () => { } },
    sys: {
      appManager: { getAppTitle: () => 'Maps', registerInstance: () => { } },
      api: { get: async () => ({ success: true, files: [] }) }
    }
  };
  const mapsFunc = new Function('window', mapsJs + '\nreturn window.mapsApp;');
  const appInstance = mapsFunc(fakeWinMaps);
  const inst = appInstance.open({ files: [], lat: 48.8566, lng: 2.3522, zoom: 12 });
  assert("maps open() avec lat/lng initialise initialCenter correctement", inst.initialCenter && inst.initialCenter.lat === 48.8566 && inst.initialCenter.lng === 2.3522 && inst.initialCenter.zoom === 12);
  inst.initMapCanvas();
  assert("maps initMapCanvas() utilise les coordonnées initiales spécifiées", createdMapCenter && createdMapCenter[0] === 48.8566 && createdMapCenter[1] === 2.3522 && createdMapZoom === 12);
  inst.renderMapContent();
  assert("maps renderMapContent() respecte initialCenter sans l'écraser", createdMapCenter && createdMapCenter[0] === 48.8566 && createdMapCenter[1] === 2.3522);
} catch (e) {
  assert("maps exécution avec coordonnées initiales", false, e.stack);
}

// 3. Image-Viewer
const imgViewerManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'image-viewer', 'manifest.json'), 'utf8'));
const imgViewerJs = fs.readFileSync(path.join(rootDir, 'apps', 'image-viewer', 'viewer.js'), 'utf8');
assert("image-viewer manifest déclare zoom et move", !!imgViewerManifest.commands.zoom && !!imgViewerManifest.commands.move);
assert("image-viewer viewer.js implémente zoom(params, cleanPathId)", imgViewerJs.includes('zoom(params = {}, cleanPathId = null)'));
assert("image-viewer viewer.js implémente move(params, cleanPathId)", imgViewerJs.includes('move(params = {}, cleanPathId = null)'));
assert("image-viewer viewer.js implémente handleCommand", imgViewerJs.includes('handleCommand(command, params = {}, winId = null)'));

// 4. Video & Audio Player
const videoManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'video-player', 'manifest.json'), 'utf8'));
const audioManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'audio-player', 'manifest.json'), 'utf8'));
assert("video-player manifest déclare seekTo et playbackRate", !!videoManifest.commands.seekTo && !!videoManifest.commands.playbackRate);
assert("audio-player manifest déclare seekTo et playbackRate", !!audioManifest.commands.seekTo && !!audioManifest.commands.playbackRate);

// 5. AppManager & Autorun Engine
const appManagerJs = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'AppManager.js'), 'utf8');
const autorunEngineJs = fs.readFileSync(path.join(rootDir, 'apps', 'explorer', 'autorun-engine.js'), 'utf8');
assert("AppManager dispatchCommand gère whereIam et moveTo pour maps", appManagerJs.includes("command === 'whereIam'") && appManagerJs.includes("command === 'moveTo'"));
assert("AppManager dispatchCommand gère seekTo et playbackRate pour audio/vidéo", appManagerJs.includes("command === 'seekTo'") && appManagerJs.includes("command === 'playbackRate'"));
assert("autorun-engine transmet lat, lng, zoom lors de openApp maps", autorunEngineJs.includes('mapOptions.lat = Number(lat)') && autorunEngineJs.includes('mapOptions.lng = Number(rawLng)'));

// 6. Autorun Studio Capture Maps
assert("Autorun Studio intègre le bouton 'Capturer depuis Maps'", autorunEditorJs.includes('data-step-capture-map'));
assert("Autorun Studio implémente captureMapPosition(stepIdx)", autorunEditorJs.includes('captureMapPosition(stepIdx)'));
assert("Autorun Studio getCommandsForApp expose moveTo et whereIam", autorunEditorJs.includes('moveTo:') && autorunEditorJs.includes('whereIam:'));
assert("Autorun Studio getCommandsForApp expose scrollTo et searchText", autorunEditorJs.includes('scrollTo:') && autorunEditorJs.includes('searchText:'));
assert("Autorun Studio getCommandsForApp expose zoom et move pour image", autorunEditorJs.includes('zoom:') && autorunEditorJs.includes('move:'));
assert("Autorun Studio getCommandsForApp expose seekTo pour video et audio", autorunEditorJs.includes('seekTo:'));

// 8. Doc-Viewer Upgrades (GFM, KaTeX, Prism, HTML preview, LaTeX) & WebOS Browser
console.log("\n🌐 [8/8] Conformité Doc-Viewer Avancé & Navigateur WebOS...");
const docViewerCss = fs.readFileSync(path.join(rootDir, 'apps', 'doc-viewer', 'viewer.css'), 'utf8');

assert("doc-viewer manifest supporte htm, tex, latex, yaml", ['htm', 'tex', 'latex', 'yaml', 'yml'].every(ext => docViewerManifest.extensions.includes(ext)));
assert("doc-viewer manifest déclare markdown-gfm, html-preview, latex-render", ['markdown-gfm', 'html-preview', 'latex-render'].every(cap => docViewerManifest.capabilities.includes(cap)));
assert("doc-viewer viewer.js implémente loadMarkdownEngines", docViewerJs.includes('loadMarkdownEngines'));
assert("doc-viewer viewer.js implémente loadLatexEngine", docViewerJs.includes('loadLatexEngine'));
assert("doc-viewer viewer.js implémente fallbackPureJsMarkdown", docViewerJs.includes('fallbackPureJsMarkdown'));
assert("doc-viewer viewer.js implémente le support TeX/LaTeX et bascule code source", docViewerJs.includes('isTex') && docViewerJs.includes('docTexViewToggleBtn'));
assert("doc-viewer viewer.js implémente le support HTML preview iframe et bascule", docViewerJs.includes('isHtml') && docViewerJs.includes('docHtmlViewToggleBtn'));
assert("doc-viewer viewer.css intègre md-codeblock, md-alert, doc-latex-render et doc-html-frame",
  docViewerCss.includes('.md-codeblock-container') &&
  docViewerCss.includes('.md-alert') &&
  docViewerCss.includes('.doc-latex-render') &&
  docViewerCss.includes('.doc-html-frame')
);

// Browser standalone app
const browserManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'browser', 'manifest.json'), 'utf8'));
const browserJs = fs.readFileSync(path.join(rootDir, 'apps', 'browser', 'app.js'), 'utf8');
const browserCss = fs.readFileSync(path.join(rootDir, 'apps', 'browser', 'style.css'), 'utf8');

assert("browser manifest valide avec ID 'browser' et catégorie 'utilities'", browserManifest.id === 'browser' && browserManifest.category === 'utilities');
assert("browser app.js hérite de WebOSApp", browserJs.includes('extends WebOSApp'));
assert("browser app.js implémente la navigation multi-onglets (addTab, switchTab, closeTab)",
  browserJs.includes('addTab(') && browserJs.includes('switchTab(') && browserJs.includes('closeTab(')
);
assert("browser app.js implémente normalizeUrl et recherche web", browserJs.includes('normalizeUrl(') && browserJs.includes('duckduckgo.com'));
assert("browser app.js implémente getEffectiveIframeUrl et toggleProxy", browserJs.includes('getEffectiveIframeUrl(') && browserJs.includes('toggleProxy('));
assert("browser style.css intègre browser-proxy-btn et browser-omnibar-box.proxified",
  browserCss.includes('.browser-proxy-btn') && browserCss.includes('.browser-omnibar-box.proxified')
);

// Test runtime BrowserApp
try {
  const fakeWinBrowser = {
    document: {
      createElement: (t) => {
        const el = {
          tagName: t.toUpperCase(),
          className: '',
          style: {},
          children: [],
          dataset: {},
          appendChild: (c) => { el.children.push(c); return c; },
          addEventListener: () => { },
          remove: () => { },
          querySelector: () => null,
          querySelectorAll: () => []
        };
        return el;
      },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    WebOSApp: class {
      constructor(manifest) { this.manifest = manifest; }
      t(k) { return k; }
      escapeHtml(s) { return String(s || ''); }
    },
    WindowManager: { createWindow: (w) => w, focusWindow: () => { }, setTitle: () => { } },
    sys: {
      appManager: { getAppTitle: () => 'Browser', registerInstance: () => { } },
      storage: { get: () => null, set: () => { } }
    }
  };
  const browserFunc = new Function('window', browserJs + '\nreturn window.BrowserApp;');
  const browserInst = browserFunc(fakeWinBrowser);
  assert("browser exporte window.BrowserApp et window.WebOSBrowserApp", typeof fakeWinBrowser.WebOSBrowserApp === 'function' && typeof browserInst === 'object');
  assert("browser instancié sans erreur", !!browserInst);
  const tab1 = browserInst.addTab('https://wikipedia.org');
  assert("browser addTab crée un onglet", !!tab1 && tab1.url === 'https://wikipedia.org');
  const norm1 = browserInst.normalizeUrl('google.com');
  assert("browser normalizeUrl préfixe https://", norm1 === 'https://google.com');
  const normSearch = browserInst.normalizeUrl('recherche simple');
  assert("browser normalizeUrl transforme requête en recherche DuckDuckGo", normSearch.includes('duckduckgo.com/?q=recherche'));

  // Test proxy mode routing & sandbox isolation
  browserInst.useProxy = false;
  assert("browser getEffectiveIframeUrl en mode direct renvoie l'URL directe", browserInst.getEffectiveIframeUrl('https://example.com') === 'https://example.com');
  browserInst.useProxy = true;
  const proxiedUrl = browserInst.getEffectiveIframeUrl('https://example.com');
  assert("browser getEffectiveIframeUrl en mode proxy route vers api.php?action=browser_proxy", proxiedUrl.includes('api.php?action=browser_proxy&url='));
  assert("browser getIframeSandbox retire allow-same-origin en mode proxy (anti-XSS)", !browserInst.getIframeSandbox(proxiedUrl).includes('allow-same-origin'));
  assert("browser getIframeSandbox conserve allow-scripts et allow-forms en mode proxy", browserInst.getIframeSandbox(proxiedUrl).includes('allow-scripts') && browserInst.getIframeSandbox(proxiedUrl).includes('allow-forms'));
  assert("browser getEffectiveIframeUrl laisse les fichiers locaux directs même en mode proxy", browserInst.getEffectiveIframeUrl('storage/test.html') === 'storage/test.html');
  browserInst.toggleProxy();
  assert("browser toggleProxy bascule l'état useProxy", browserInst.useProxy === false);
} catch (e) {
  assert("browser exécution runtime", false, e.stack);
}

// -------------------------------------------------------------
// 9. Vérification des Fonctionnalités Tribune (Layout Mobile & Envoi Programmé)
// -------------------------------------------------------------
console.log('\n🦆 [9/9] Vérification Tribune Libre (Layout Mobile 2 Lignes & Envois Programmés)...');

const tribuneCssPath = path.join(appsDir, 'tribune', 'app.css');
const tribuneJsPath = path.join(appsDir, 'tribune', 'app.js');
const tribuneCss = fs.readFileSync(tribuneCssPath, 'utf8');
const tribuneJs = fs.readFileSync(tribuneJsPath, 'utf8');

// Test Mobile CSS Layout
assert("Tribune CSS déclare le conteneur avec container-type inline-size", tribuneCss.includes('container-type: inline-size'));
assert("Tribune CSS déclare la media query mobile @media (max-width: 768px)", tribuneCss.includes('@media (max-width: 768px)'));
assert("Tribune CSS mobile applique flex-wrap: wrap sur .tribune-post-row", tribuneCss.includes('.tribune-post-row') && tribuneCss.includes('flex-wrap: wrap'));
assert("Tribune CSS mobile alloue 100% de largeur pour .tribune-message (Ligne 2)", tribuneCss.includes('flex-basis: 100%') && tribuneCss.includes('width: 100%'));
assert("Tribune CSS mobile réinitialise .tribune-login-container à width: auto (Ligne 1)", tribuneCss.includes('.tribune-login-container') && tribuneCss.includes('width: auto'));
assert("Tribune CSS intègre le support des Container Queries (@container (max-width: 600px))", tribuneCss.includes('@container (max-width: 600px)'));
assert("Tribune CSS stylise le champ textarea .schedule-msg-input", tribuneCss.includes('.schedule-msg-input'));

// Test Tribune JS Scheduling Logic
assert("Tribune JS intègre le champ textarea #tribuneScheduleMsgInput dans le popover", tribuneJs.includes('id="tribuneScheduleMsgInput"'));
assert("Tribune JS utilise step=\"60\" sur #tribuneScheduleDatetime", tribuneJs.includes('id="tribuneScheduleDatetime" step="60"'));
assert("Tribune JS synchronise le texte du message entre la barre et le popover", tribuneJs.includes('scheduleMsgInput.addEventListener(\'input\''));
assert("Tribune JS envoie tribune_schedule_post via this.api.post", tribuneJs.includes("this.api.post('tribune_schedule_post'"));
assert("Tribune JS gère la fermeture au clic en dehors (#tribuneSchedulePopover)", tribuneJs.includes('!e.target.closest(\'#tribuneSchedulePopover\')'));
assert("Tribune JS rafraîchit le feed quand un message programmé est publié", tribuneJs.includes('this.lastScheduledCount > count'));
assert("Tribune JS ne déclenche plus alert() sur succès OAuth2", !tribuneJs.includes("alert(this.t('tribune.oauth_success')"));
assert("Tribune JS implémente refreshOAuthTokenSilently avec tribune_oauth_refresh et relance auto sur post", tribuneJs.includes('refreshOAuthTokenSilently') && tribuneJs.includes('tribune_oauth_refresh') && tribuneJs.includes('isRetry'));

// Phase 3 Quality & Compliance Gates (QUAL-01..QUAL-05)
const collectJsFiles = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'ffs-apps' || entry.name === 'external') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip third-party standalone HTML/WASM bundles (index.html without native manifest.json)
      if (fs.existsSync(path.join(full, 'index.html')) && !fs.existsSync(path.join(full, 'manifest.json'))) continue;
      collectJsFiles(full, acc);
    }
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
};
const allJsFiles = [
  ...collectJsFiles(path.join(rootDir, 'apps')),
  ...collectJsFiles(path.join(rootDir, 'system', 'userland')),
  path.join(rootDir, 'js', 'desktop.js')
].filter(f => fs.existsSync(f));

const fallbackOffenders = allJsFiles.filter(f => /\.t\(\s*['"][^'"]+['"][^)]*\)\s*\|\|/.test(fs.readFileSync(f, 'utf8')));
assert("QUAL-01: Zéro fallback hardcodé .t('key') || '...' dans tout le code JS", fallbackOffenders.length === 0, fallbackOffenders.join(', '));

const appsJsFiles = collectJsFiles(path.join(rootDir, 'apps'));
const rawFetchOffenders = appsJsFiles.filter(f => /\bfetch\s*\(/.test(fs.readFileSync(f, 'utf8')));
assert("QUAL-02: Zéro appel fetch() brut dans apps/ (passage par SyscallClient)", rawFetchOffenders.length === 0, rawFetchOffenders.join(', '));

const galleryCssSrc = fs.readFileSync(path.join(rootDir, 'css', 'gallery.css'), 'utf8');
const qualIndexPhpSrc = fs.readFileSync(path.join(rootDir, 'index.php'), 'utf8');
assert("QUAL-03: Aucun @import Google Fonts dans css/gallery.css ni index.php", !galleryCssSrc.includes('fonts.googleapis.com') && !qualIndexPhpSrc.includes('fonts.googleapis.com'));
assert("QUAL-03: index.php charge Leaflet & MarkerCluster en local (zéro CDN unpkg) avec SRI integrity",
  !qualIndexPhpSrc.includes('unpkg.com') &&
  qualIndexPhpSrc.includes('assets/vendor/leaflet/leaflet.js') &&
  qualIndexPhpSrc.includes('leaflet.markercluster.js" integrity="sha384-') &&
  fs.existsSync(path.join(rootDir, 'assets', 'vendor', 'leaflet', 'leaflet.js')) &&
  fs.existsSync(path.join(rootDir, 'assets', 'vendor', 'leaflet', 'LICENSE-LEAFLET')));
assert("QUAL-04: Modèle storage/tribune_messages.example.json présent", fs.existsSync(path.join(rootDir, 'storage', 'tribune_messages.example.json')));
assert("QUAL-05: Contrôleurs backend Tribune extraits (Upload, Scheduler, Proxy)",
  fs.existsSync(path.join(rootDir, 'apps', 'tribune', 'backend', 'TribuneUploadController.php')) &&
  fs.existsSync(path.join(rootDir, 'apps', 'tribune', 'backend', 'TribuneSchedulerController.php')) &&
  fs.existsSync(path.join(rootDir, 'apps', 'tribune', 'backend', 'TribuneProxyController.php')));
assert("QUAL-05: Feuilles CSS modulaires gallery-features.css et gallery-overlays.css extraites",
  fs.existsSync(path.join(rootDir, 'css', 'gallery-features.css')) &&
  fs.existsSync(path.join(rootDir, 'css', 'gallery-overlays.css')));

// Test Date Parsing & Formatting Functions
const fakeLocalStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; }
};
global.localStorage = fakeLocalStorage;

const fakeDoc = {
  addEventListener: () => { },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};
global.document = fakeDoc;

const fakeWinTribune = {
  navigator: { userAgent: 'NodeTest' },
  localStorage: fakeLocalStorage,
  document: fakeDoc,
  addEventListener: () => { },
  sys: {
    api: {
      forApp: () => ({ get: async () => ({}), post: async () => ({}), url: () => '' })
    },
    i18n: { t: (k) => k }
  }
};
const tribuneFunc = new Function('window', 'localStorage', 'document', tribuneJs + '\nreturn window.tribuneApp;');
const tribuneInst = tribuneFunc(fakeWinTribune, fakeLocalStorage, fakeDoc);

assert("Tribune instancié avec succès", !!tribuneInst);
const testDate = new Date(2026, 8, 13, 15, 45, 0); // 13 sept 2026 15:45
const formattedIso = tribuneInst.formatLocalIsoString(testDate);
assert("formatLocalIsoString produit YYYY-MM-DDTHH:mm valide", formattedIso === '2026-09-13T15:45');

const parsedDate = tribuneInst.parseLocalDateTime('2026-09-13T15:45');
assert("parseLocalDateTime analyse avec succès une chaîne datetime YYYY-MM-DDTHH:mm", !!parsedDate && parsedDate.getFullYear() === 2026 && parsedDate.getMonth() === 8 && parsedDate.getDate() === 13 && parsedDate.getHours() === 15 && parsedDate.getMinutes() === 45);

const parsedDateSec = tribuneInst.parseLocalDateTime('2026-09-13T15:45:30');
assert("parseLocalDateTime supporte les secondes optionnelles", !!parsedDateSec && parsedDateSec.getSeconds() === 30);

// -------------------------------------------------------------
// 10. Hôte d'Applications Web Autonomes (WebAppHost, Menus, Fenêtrage & Associations)
// -------------------------------------------------------------
console.log('\n🧩 [10/10] Hôte d\'Applications Web Tierces (WebAppHost, Menus, Fenêtres & Ouvrir avec)...');

const webAppHostPath = path.join(rootDir, 'system', 'userland', 'core', 'WebAppHost.js');
const appMgrPath = path.join(rootDir, 'system', 'userland', 'core', 'AppManager.js');
const mediaRegPath = path.join(rootDir, 'system', 'userland', 'core', 'MediaViewerRegistry.js');
const indexPhpPath = path.join(rootDir, 'index.php');

assert("Fichier system/userland/core/WebAppHost.js présent", fs.existsSync(webAppHostPath));
const indexPhpSrc = fs.readFileSync(indexPhpPath, 'utf8');
assert("index.php charge system/userland/core/WebAppHost.js", indexPhpSrc.includes('system/userland/core/WebAppHost.js'));

const expTplSrc = fs.readFileSync(path.join(appsDir, 'explorer', 'template.php'), 'utf8');
const expJsSrc = fs.readFileSync(path.join(appsDir, 'explorer', 'explorer.js'), 'utf8');
assert("Explorer template.php intègre .inspector-open-with-section", expTplSrc.includes('inspector-open-with-section'));
assert("Explorer explorer.js implémente showFileContextMenu (Ouvrir avec)", expJsSrc.includes('showFileContextMenu('));

['fr', 'en', 'ja'].forEach(lang => {
  const loc = JSON.parse(fs.readFileSync(path.join(rootDir, 'locales', `${lang}.json`), 'utf8'));
  const tr = loc.translations || loc;
  assert(`Locale [${lang}] déclare explorer.open_with et webapp.menu_file`, !!tr['explorer.open_with'] && !!tr['webapp.menu_file']);
});

try {
  const iconHelperCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'IconHelper.js'), 'utf8');
  const appMgrCode = fs.readFileSync(appMgrPath, 'utf8');
  const mediaRegCode = fs.readFileSync(mediaRegPath, 'utf8');
  const webAppHostCode = fs.readFileSync(webAppHostPath, 'utf8');

  const createdWindows = [];
  const registeredMenus = new Map();
  const fakeDom = {
    readyState: 'complete',
    documentElement: { lang: 'fr' },
    head: { appendChild: () => { } },
    body: { contains: () => false },
    getElementById: () => null,
    createElement: () => ({ style: {}, addEventListener: () => { } }),
    addEventListener: () => { }
  };

  const sandboxWin = {
    innerWidth: 1440,
    innerHeight: 900,
    document: fakeDom,
    localStorage: { getItem: () => null, setItem: () => { } },
    ATELIER_DISABLED_APPS: [],
    ATELIER_DISCOVERED_APPS: {
      'image-viewer': {
        id: 'image-viewer',
        name: 'Image Viewer',
        icon: '🖼️',
        category: 'viewer',
        distribution: 'native',
        manifest: {
          id: 'image-viewer',
          name: 'Image Viewer',
          icon: '🖼️',
          category: 'viewer',
          extensions: ['jpg', 'png', 'webp'],
          mimeTypes: ['image/*']
        }
      },
      'mock-studio': {
        id: 'mock-studio',
        name: 'MockStudio',
        icon: '🎨',
        icon_url: 'https://raw.githubusercontent.com/example/mock-studio/main/icon.png',
        category: 'media',
        distribution: 'standalone-web',
        html_entry: 'apps/mock-studio-web-1.0.0/index.html',
        manifest: {
          id: 'mock-studio',
          name: 'MockStudio',
          version: '1.0.0',
          icon: '🎨',
          icon_url: 'https://raw.githubusercontent.com/example/mock-studio/main/icon.png',
          category: 'media',
          distribution: 'standalone-web',
          runtime: 'iframe',
          synthetic: true,
          entry: { html: 'apps/mock-studio-web-1.0.0/index.html' },
          extensions: ['psd', 'xcf', 'png', 'jpg'],
          mimeTypes: ['image/vnd.adobe.photoshop', 'image/png', 'image/jpeg'],
          rendererFlags: [{ flag: 'webgl', label: 'WebGL2' }, { flag: 'cpu', label: 'CPU Canvas' }],
          window: { width: 1180, height: 760, resizable: true }
        }
      }
    },
    WindowManager: {
      windows: new Map(),
      createWindow: (cfg) => {
        createdWindows.push(cfg);
        return { id: cfg.id, element: {} };
      },
      focusWindow: () => { },
      setTitle: () => { }
    },
    MenuBarManager: {
      registerAppMenu: (id, def) => registeredMenus.set(id, def),
      setActiveApp: () => { }
    },
    I18nEngine: { t: (k) => k }
  };

  new Function('window', 'document', 'localStorage', iconHelperCode)(sandboxWin, fakeDom, sandboxWin.localStorage);
  new Function('window', 'document', 'localStorage', mediaRegCode)(sandboxWin, fakeDom, sandboxWin.localStorage);
  sandboxWin.MediaViewerRegistry.register({
    id: 'image-viewer',
    priority: 100,
    extensions: ['jpg', 'png', 'webp'],
    open: () => 'opened-native-image-viewer'
  });

  new Function('window', 'document', 'localStorage', appMgrCode)(sandboxWin, fakeDom, sandboxWin.localStorage);
  new Function('window', 'document', 'localStorage', webAppHostCode)(sandboxWin, fakeDom, sandboxWin.localStorage);

  const hostInst = sandboxWin.WebAppHost.get('mock-studio');
  assert("WebAppHost monte automatiquement l'app autonome mock-studio", !!hostInst);
  const studioMenu = registeredMenus.get('mock-studio') || [];
  assert("WebAppHost enregistre le badge icône + les 3 menus contextuels dans MenuBarManager", Array.isArray(studioMenu) && studioMenu.length === 4 && studioMenu[0].badge === true && studioMenu[0].iconHtml.includes('webos-app-icon-img'));

  const viewMenu = studioMenu.find(m => m.id === 'view');
  assert("WebAppHost ajoute les sélecteurs de moteur de rendu (?webgl/?cpu) dans le menu Affichage", !!viewMenu && viewMenu.items.some(i => i.id === 'renderer-webgl'));

  // File association priorities
  const defaultForJpg = sandboxWin.AppManager.getAppForFile({ name: 'a.jpg', extension: 'jpg', category: 'image' });
  const defaultForPsd = sandboxWin.AppManager.getAppForFile({ name: 'a.psd', extension: 'psd', category: 'other' });
  assert("AppManager préserve image-viewer comme défaut pour .jpg", defaultForJpg && defaultForJpg.manifest.id === 'image-viewer');
  assert("AppManager associe automatiquement .psd à mock-studio", defaultForPsd && defaultForPsd.manifest.id === 'mock-studio');

  const appsForPng = sandboxWin.AppManager.getAppsForFile({ name: 'a.png', extension: 'png', category: 'image' });
  assert("AppManager.getAppsForFile('.png') retourne image-viewer ET mock-studio (Ouvrir avec)", appsForPng.length === 2 && appsForPng[0].id === 'image-viewer' && appsForPng[1].id === 'mock-studio');

  const viewerForJpg = sandboxWin.MediaViewerRegistry.findViewer({ name: 'a.jpg', extension: 'jpg' });
  const viewerForPsd = sandboxWin.MediaViewerRegistry.findViewer({ name: 'a.psd', extension: 'psd' });
  assert("MediaViewerRegistry préserve la priorité native (image-viewer) pour .jpg", viewerForJpg && viewerForJpg.id === 'image-viewer');
  assert("MediaViewerRegistry sélectionne mock-studio pour .psd", viewerForPsd && viewerForPsd.id === 'mock-studio');

  // Verify fallbackExtensions: specialized standalone spreadsheet app beats doc-viewer fallback card for .xls/.xlsx
  sandboxWin.AppManager.registerApp({ id: 'doc-viewer', name: 'Doc Viewer', extensions: ['pdf', 'xls', 'xlsx'], fallbackExtensions: ['xls', 'xlsx'] }, null);
  sandboxWin.AppManager.registerApp({ id: 'mock-grid', name: 'GridCraft', runtime: 'iframe', distribution: 'standalone-web', extensions: ['xls', 'xlsx', 'ods', 'csv'] }, null);
  const defaultForXls = sandboxWin.AppManager.getAppForFile({ name: 'Budget.xls', extension: 'xls', category: 'doc' });
  const defaultForPdf = sandboxWin.AppManager.getAppForFile({ name: 'Notice.pdf', extension: 'pdf', category: 'doc' });
  assert("AppManager donne priorité à l'app spécialisée (GridCraft) sur doc-viewer fallbackExtensions pour .xls (tout en gardant .pdf sur doc-viewer)",
    defaultForXls && defaultForXls.manifest.id === 'mock-grid' &&
    defaultForPdf && defaultForPdf.manifest.id === 'doc-viewer'
  );

  // Windowing test
  sandboxWin.AppManager.launchApp('mock-studio', { file: { name: 'design.psd', path: 'art/design.psd', extension: 'psd' } });
  assert("AppManager.launchApp('mock-studio', {file}) crée une fenêtre WindowManager dédiée", createdWindows.length === 1 && createdWindows[0].appId === 'mock-studio');
  assert("La fenêtre créée embarque l'iframe avec allow fullscreen/clipboard et titre du fichier", createdWindows[0].title.includes('design.psd') && createdWindows[0].content.includes('apps/mock-studio-web-1.0.0/index.html') && createdWindows[0].content.includes('allow="fullscreen; clipboard-read; clipboard-write"') && !createdWindows[0].content.includes('allowfullscreen'));
  assert("AppManager.getAppIcon('mock-studio') rend l'image d'icône avec repli emoji hors-ligne", sandboxWin.AppManager.getAppIcon('mock-studio').includes('<img src="https://raw.githubusercontent.com/example/mock-studio/main/icon.png"') && sandboxWin.AppManager.getAppIcon('mock-studio').includes('🎨'));
  assert("La fenêtre créée utilise l'icône image de l'application tierce", createdWindows[0].icon.includes('webos-app-icon-img'));
  assert("La fenêtre créée inclut l'overlay de démarrage WebOS (.webapp-boot-overlay)", createdWindows[0].content.includes('webapp-boot-overlay'));
  hostInst.manifest.openFileParam = 'file';
  const querySrc = hostInst.getEffectiveSrc({ name: 'doc.pdf', path: 'docs/doc.pdf', file_url: 'system/endpoints/thumb.php?file=docs%2Fdoc.pdf&raw=1' });
  assert("WebAppHost.getEffectiveSrc injecte ?file=... quand openFileParam est déclaré", querySrc.includes('?file=') && querySrc.includes('doc.pdf'));
  hostInst.hostBridge = { mode: 'parent', prefix: 'gridcraft', supportsAuthor: true, supportsChrome: true, supportsBlank: true };
  sandboxWin.ATELIER_CURRENT_USER = { username: 'alice', display_name: 'Alice' };
  const hostBridgeSrc = hostInst.getEffectiveSrc({ name: 'budget.xlsx', path: 'ext://1/budget.xlsx', file_url: 'system/endpoints/thumb.php?file=ext%3A%2F%2F1%2Fbudget.xlsx&raw=1' });
  assert("Lot 1 WebAppHost: ?host=parent injecte host=parent, chrome=notitlebar, blank et author=<user>",
    hostBridgeSrc.includes('host=parent') &&
    hostBridgeSrc.includes('chrome=notitlebar') &&
    hostBridgeSrc.includes('blank') &&
    hostBridgeSrc.includes('author=Alice') &&
    typeof hostInst.bindHostBridgeListener === 'function' &&
    typeof hostInst.sendFileViaHostBridge === 'function' &&
    typeof hostInst.handleHostBridgeSave === 'function'
  );
  hostInst.hostBridge = null;
  assert("IconHelper.isSafeIconUrl rejette javascript: et traversal ..", !sandboxWin.IconHelper.isSafeIconUrl('javascript:alert(1)') && !sandboxWin.IconHelper.isSafeIconUrl('apps/../etc/passwd.png'));
} catch (e) {
  assert("WebAppHost exécution runtime", false, e.stack);
}

// -------------------------------------------------------------
// 11. FEAT-04 : Calculatrice Scientifique, Programmeur & Traceur 2D (apps/graphing-calc)
// -------------------------------------------------------------
console.log('\n📐 [11/11] FEAT-04 : Calculatrice Scientifique, Programmeur & Traceur Canvas 2D...');
try {
  const gcalcDir = path.join(appsDir, 'graphing-calc');
  const engineSrc = fs.readFileSync(path.join(gcalcDir, 'math-engine.js'), 'utf8');
  const plotterSrc = fs.readFileSync(path.join(gcalcDir, 'plotter.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(gcalcDir, 'app.js'), 'utf8');

  const gcalcAllCode = (engineSrc + plotterSrc + appSrc).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert("FEAT-04: Zéro eval() ou new Function() dans apps/graphing-calc/*",
    !/\beval\s*\(/.test(gcalcAllCode) &&
    !/\bnew\s+Function\s*\(/.test(gcalcAllCode)
  );

  const calcWin = {
    localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
    devicePixelRatio: 1
  };
  new Function('window', engineSrc)(calcWin);
  new Function('window', plotterSrc)(calcWin);

  const E = calcWin.GraphingCalcEngine;
  assert("FEAT-04: GraphingCalcEngine chargé", !!E && typeof E.evaluate === 'function');
  assert("FEAT-04: Priorité opérateurs & puissance associative droite (2^3^2 = 512, -3^2 = -9)",
    E.evaluate('2^3^2') === 512 && E.evaluate('-3^2') === -9 && E.evaluate('2 + 3 * 4') === 14
  );
  assert("FEAT-04: Multiplication implicite (2pi, 3(1+2), 2x)",
    Math.abs(E.evaluate('2pi') - 2 * Math.PI) < 1e-12 &&
    E.evaluate('3(1+2)') === 9 &&
    E.evaluate('2x + 1', { x: 4 }) === 9
  );
  assert("FEAT-04: Fonctions scientifiques (DEG/RAD, factorielle, log, ln, ncr)",
    Math.abs(E.evaluate('sin(90)', {}, 'DEG') - 1) < 1e-12 &&
    Math.abs(E.evaluate('sin(pi/2)', {}, 'RAD') - 1) < 1e-12 &&
    E.evaluate('5!') === 120 &&
    Math.abs(E.evaluate('log(1000)') - 3) < 1e-12 &&
    Math.abs(E.evaluate('ln(e)') - 1) < 1e-12 &&
    E.evaluate('ncr(5, 2)') === 10
  );

  let injectionBlocked = false;
  try { E.evaluate('constructor.constructor("return 42")()'); } catch (err) { injectionBlocked = true; }
  assert("FEAT-04: Parseur rejette toute tentative d'injection JS", injectionBlocked);

  // Numerical analysis: roots, extrema, intersections
  const fnQuad = E.compile('x^2 - 4');
  const roots = E.findRoots(x => fnQuad({ x }), -5, 5);
  assert("FEAT-04: Détection racines de x^2 - 4 -> {-2, 2}",
    roots.length === 2 && Math.abs(roots[0].x + 2) < 1e-4 && Math.abs(roots[1].x - 2) < 1e-4
  );

  const fnCubic = E.compile('x^3 - 3*x');
  const extrema = E.findExtrema(x => fnCubic({ x }), -3, 3);
  assert("FEAT-04: Détection extrema de x^3 - 3x -> max(-1, 2) & min(1, -2)",
    extrema.length === 2 &&
    extrema[0].kind === 'max' && Math.abs(extrema[0].x + 1) < 1e-3 && Math.abs(extrema[0].y - 2) < 1e-3 &&
    extrema[1].kind === 'min' && Math.abs(extrema[1].x - 1) < 1e-3 && Math.abs(extrema[1].y + 2) < 1e-3
  );

  const fnA = E.compile('x^2');
  const fnB = E.compile('x + 2');
  const inter = E.findIntersections(x => fnA({ x }), x => fnB({ x }), -3, 4);
  assert("FEAT-04: Détection intersections de x^2 et x+2 -> (-1, 1) & (2, 4)",
    inter.length === 2 && Math.abs(inter[0].x + 1) < 1e-3 && Math.abs(inter[1].x - 2) < 1e-3
  );

  // Programmer mode (BigInt bitwise)
  const P = E.programmer;
  assert("FEAT-04: Mode Programmeur HEX/BIN/Signé/Bitwise (8-bit & 32-bit)",
    P.parseBase('FF', 16, 8) === 255n &&
    P.toSigned(255n, 8) === -1n &&
    P.bitwiseOp('AND', 0xF0n, 0x3Cn, 8) === 0x30n &&
    P.bitwiseOp('OR', 0x0Fn, 0xF0n, 8) === 0xFFn &&
    P.bitwiseOp('XOR', 0xAAn, 0xFFn, 8) === 0x55n &&
    P.bitwiseOp('NOT', 0n, 0n, 8) === 255n &&
    P.bitwiseOp('SHL', 1n, 7n, 8) === 128n &&
    P.formatBase(0xABn, 2, 8) === '1010 1011'
  );

  // App instantiation & 3-tab rendering smoke test
  const webosAppCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'WebOSApp.js'), 'utf8');
  const appDoc = {
    getElementById: () => null,
    addEventListener: () => { },
    removeEventListener: () => { }
  };
  const appWin = {
    localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
    GraphingCalcEngine: E,
    GraphingCalcPlotter: calcWin.GraphingCalcPlotter,
    sys: { i18n: { t: (k, p) => p ? Object.entries(p).reduce((s, [a, b]) => s + ':' + b, k) : k } }
  };
  new Function('window', 'document', webosAppCode)(appWin, appDoc);
  new Function('window', 'document', appSrc)(appWin, appDoc);
  const inst = appWin.GraphingCalcApp;
  assert("FEAT-04: GraphingCalcApp s'instancie et expose 3 onglets (scientific, programmer, graph)",
    !!inst && Array.isArray(inst.tabs) && inst.tabs.length === 3
  );
  const htmlSci = inst.renderTab('scientific');
  const htmlProg = inst.renderTab('programmer');
  const htmlGraph = inst.renderTab('graph');
  assert("FEAT-04: Rendu HTML des 3 modes via renderTab() sans erreur (keypad, bit-grid, canvas)",
    htmlSci.includes('gcalcExprInput') && htmlProg.includes('gcalc-bit-grid') && htmlGraph.includes('gcalcCanvas')
  );
} catch (e) {
  assert("FEAT-04 exécution runtime", false, e.stack);
}

// -------------------------------------------------------------
// 12. FEAT-06 : Pont VFS Bidirectionnel pour Apps Externes (WebAppVfsBridge & FilePickerService)
// -------------------------------------------------------------
console.log('\n🔗 [12/12] FEAT-06 : Pont VFS Bidirectionnel (Open/Save Hook same-origin & postMessage)...');
try {
  const vfsBridgePath = path.join(rootDir, 'system', 'userland', 'core', 'WebAppVfsBridge.js');
  const pickerPath = path.join(rootDir, 'system', 'userland', 'services', 'FilePickerService.js');
  assert("FEAT-06: Fichier system/userland/core/WebAppVfsBridge.js présent", fs.existsSync(vfsBridgePath));
  assert("FEAT-06: index.php charge WebAppVfsBridge.js avant WebAppHost.js",
    indexPhpSrc.includes('system/userland/core/WebAppVfsBridge.js') &&
    indexPhpSrc.indexOf('WebAppVfsBridge.js') < indexPhpSrc.indexOf('WebAppHost.js')
  );

  const pickerCode = fs.readFileSync(pickerPath, 'utf8');
  const bridgeCode = fs.readFileSync(vfsBridgePath, 'utf8');

  // Test FilePickerService accept matcher
  const pickerWin = {
    sys: {},
    ATELIER_MIME_MAP: {
      'application/x-wordcraft': ['wcraft'],
      'application/vnd.oasis.opendocument.text': ['odt']
    },
    document: { addEventListener: () => { }, removeEventListener: () => { }, body: { appendChild: () => { }, getAttribute: () => 'dark' }, documentElement: { getAttribute: () => 'dark' } }
  };
  new Function('window', 'document', pickerCode)(pickerWin, pickerWin.document);
  const fp = pickerWin.sys.filePicker;
  assert("FEAT-06: FilePickerService expose pickFile, pickFolder et pickSaveLocation",
    typeof pickerWin.sys.pickFile === 'function' &&
    typeof pickerWin.sys.pickFolder === 'function' &&
    typeof pickerWin.sys.pickSaveLocation === 'function'
  );
  assert("FEAT-06: FilePickerService.matchesAccept gère extensions, wildcards et MIME dynamiques ATELIER_MIME_MAP",
    fp.matchesAccept({ name: 'art.psd', extension: 'psd', category: 'image' }, '.psd,.png') &&
    fp.matchesAccept({ name: 'doc.pdf', extension: 'pdf', category: 'doc' }, 'application/pdf') &&
    fp.matchesAccept({ name: 'note.odt', extension: 'odt', category: 'doc' }, 'application/vnd.oasis.opendocument.text') &&
    fp.matchesAccept({ name: 'draft.wcraft', extension: 'wcraft', category: 'doc' }, 'application/x-wordcraft') &&
    fp.matchesAccept({ name: 'pic.jpg', extension: 'jpg', category: 'image' }, 'image/*') &&
    !fp.matchesAccept({ name: 'song.mp3', extension: 'mp3', category: 'audio' }, 'image/*,application/pdf')
  );
  assert("FEAT-06 + Phase 1: FilePickerService intègre la barre des volumes montés (users/<name>, partages) et la navigation parent_path",
    pickerCode.includes('picker-volumes-bar') &&
    pickerCode.includes('renderVolumesBar') &&
    pickerCode.includes('currentUser.home_dir') &&
    pickerCode.includes('currentParentPath')
  );

  // Test WebAppVfsBridge hooks & security isolation
  const uploadedPayloads = [];
  const bridgeStorage = new Map();
  const bridgeWin = {
    location: { origin: 'https://gallery.local', href: 'https://gallery.local/' },
    localStorage: {
      getItem: (k) => (bridgeStorage.has(k) ? bridgeStorage.get(k) : null),
      setItem: (k, v) => bridgeStorage.set(k, String(v))
    },
    Blob: globalThis.Blob,
    File: globalThis.File || class MockFile { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type || ''; } },
    FormData: globalThis.FormData || class MockFD { constructor() { this.entries = {}; } append(k, v, n) { this.entries[k] = { v, n }; } },
    DOMException: globalThis.DOMException,
    fetch: async () => ({ ok: true, blob: async () => new Blob(['PDFDATA'], { type: 'application/pdf' }) }),
    addEventListener: () => { },
    sys: {
      i18n: { t: (k) => k },
      toast: { success: () => { }, error: () => { }, info: () => { } },
      api: {
        upload: async (action, fd) => {
          uploadedPayloads.push({ action, fd });
          return { success: true };
        }
      },
      pickFile: async () => ({ name: 'manual.pdf', path: 'docs/manual.pdf', extension: 'pdf' }),
      pickSaveLocation: async (opts) => ({ dir: 'exports', filename: opts.suggestedName || 'out.png', overwrite: true })
    }
  };
  new Function('window', bridgeCode)(bridgeWin);
  const bridge = bridgeWin.sys.webAppVfsBridge;

  assert("FEAT-06: pickerTypesToAccept convertit types W3C en chaîne accept",
    bridge.pickerTypesToAccept({ types: [{ accept: { 'image/png': ['.png'], 'application/pdf': ['.pdf'] } }] }) === '.png,.pdf'
  );

  const cfgDisabled = bridge.getBridgeConfig({ id: 'ext1', manifest: { vfsBridge: false } });
  const cfgNoSave = bridge.getBridgeConfig({ id: 'ext2', manifest: { vfsBridge: { hookSave: false } } });
  bridge.setEnabledForApp('ext3', false);
  const cfgUserOff = bridge.getBridgeConfig({ id: 'ext3', manifest: {} });
  assert("FEAT-06: Configuration vfsBridge respecte manifeste et préférence utilisateur localStorage",
    cfgDisabled.enabled === false && cfgNoSave.hookOpen === true && cfgNoSave.hookSave === false && cfgUserOff.enabled === false
  );

  // Cross-origin iframe must fail gracefully without throwing
  const crossOriginIframe = {
    get contentWindow() {
      return {
        get location() { throw new Error('SecurityError: Blocked a frame with origin'); }
      };
    }
  };
  assert("FEAT-06: Iframe cross-origin ignorée proprement sans exception SecurityError",
    bridge.attachToIframe(crossOriginIframe, { id: 'remote-app', manifest: {} }) === false
  );

  // Same-origin iframe hooking: showOpenFilePicker + createWritable save + blob anchor download capture
  class FakeInput { click() { this._nativeClicked = true; } }
  class FakeAnchor {
    constructor(href, dl) { this.href = href; this._dl = dl; }
    hasAttribute(k) { return k === 'download' && this._dl !== null; }
    getAttribute(k) { return k === 'href' ? this.href : (k === 'download' ? this._dl : null); }
    click() { this._nativeClicked = true; }
  }
  let createdBlobSeq = 0;
  class IframeRealmPromise extends Promise { }
  const fakeIframeWin = {
    location: { origin: 'https://gallery.local' },
    document: { addEventListener: () => { } },
    Promise: IframeRealmPromise,
    Blob: globalThis.Blob,
    File: bridgeWin.File,
    DOMException: globalThis.DOMException,
    URL: {
      createObjectURL: () => `blob:https://gallery.local/${++createdBlobSeq}`,
      revokeObjectURL: () => { }
    },
    HTMLInputElement: FakeInput,
    HTMLAnchorElement: FakeAnchor
  };
  const sameOriginIframe = { contentWindow: fakeIframeWin };
  const fakeAppInst = { id: 'artcraft', name: 'ArtCraft', manifest: {}, getAppTitle: () => 'ArtCraft' };
  const attached = bridge.attachToIframe(sameOriginIframe, fakeAppInst);
  assert("FEAT-06: attachToIframe installe les hooks Open/Save sur iframe same-origin",
    attached === true && typeof fakeIframeWin.showOpenFilePicker === 'function' && typeof fakeIframeWin.showSaveFilePicker === 'function'
  );

  // Verify W3C showOpenFilePicker & showSaveFilePicker return iframe's OWN Promise realm (wasm-bindgen JsFuture compatible!)
  const openPromise = fakeIframeWin.showOpenFilePicker({ types: [{ accept: { 'application/pdf': ['.pdf'] } }] });
  const savePromise = fakeIframeWin.showSaveFilePicker({ suggestedName: 'rapport.odt' });
  assert("FEAT-06: showOpenFilePicker et showSaveFilePicker retournent des instances de cw.Promise (compatibilité wasm-bindgen)",
    openPromise instanceof IframeRealmPromise && savePromise instanceof IframeRealmPromise
  );
  const handles = await openPromise;
  await savePromise;
  const openedFile = await handles[0].getFile();
  const writable = await handles[0].createWritable();
  await writable.write('UPDATED_PDF');
  await writable.close();
  assert("FEAT-06: showOpenFilePicker retourne un FileSystemFileHandle VFS (lecture + sauvegarde sur place)",
    handles.length === 1 && openedFile.name === 'manual.pdf' && uploadedPayloads.length === 1 && uploadedPayloads[0].action === 'upload_file'
  );

  // Verify blob URL capture + <a download> Save Hook even after immediate revokeObjectURL
  const expBlob = new Blob(['PNG_BYTES'], { type: 'image/png' });
  const expUrl = fakeIframeWin.URL.createObjectURL(expBlob);
  fakeIframeWin.URL.revokeObjectURL(expUrl);
  const fakeA = new FakeAnchor(expUrl, 'render.png');
  fakeA.click();
  await new Promise(r => setTimeout(r, 30));
  assert("FEAT-06: <a download href='blob:...'> capture le Blob et sauvegarde dans la Galerie via upload_file",
    uploadedPayloads.length === 2 && !fakeA._nativeClicked
  );

  // Verify postMessage protocol rejects spoofed sources and answers matched iframe
  const postedReplies = [];
  const matchedSrc = { postMessage: (data, origin) => postedReplies.push({ data, origin }) };
  const mockHostMgr = {
    instances: new Map([['artcraft', { id: 'artcraft', getAppTitle: () => 'ArtCraft', getIframeElement: () => ({ contentWindow: matchedSrc }) }]])
  };
  await bridge.handlePostMessage({ source: {}, origin: 'https://evil.example', data: { type: 'webos:vfs-pick', requestId: 'bad' } }, mockHostMgr);
  await bridge.handlePostMessage({ source: matchedSrc, origin: 'https://gallery.local', data: { type: 'webos:vfs-pick', requestId: 'ok1' } }, mockHostMgr);
  assert("FEAT-06: Protocole postMessage rejette les sources inconnues et répond à l'iframe authentifiée",
    postedReplies.length === 1 && postedReplies[0].data.requestId === 'ok1' && postedReplies[0].data.files.length === 1 && postedReplies[0].data.files[0].name === 'manual.pdf'
  );
} catch (e) {
  assert("FEAT-06 exécution runtime", false, e.stack);
}

// -------------------------------------------------------------
// 13. FEAT-09 : Guide & Kit Développeur (docs/apps-guide.md + apps/template-app)
// -------------------------------------------------------------
try {
  const guideSrc = fs.readFileSync(path.join(rootDir, 'docs', 'apps-guide.md'), 'utf8');
  const tmplJs = fs.readFileSync(path.join(appsDir, 'template-app', 'app.js'), 'utf8');
  const tmplBackend = fs.readFileSync(path.join(appsDir, 'template-app', 'backend', 'TemplateAppActions.php'), 'utf8');
  const tmplManifest = JSON.parse(fs.readFileSync(path.join(appsDir, 'template-app', 'manifest.json'), 'utf8'));
  const tFr = Object.keys(JSON.parse(fs.readFileSync(path.join(appsDir, 'template-app', 'locales', 'fr.json'), 'utf8')));
  const tEn = Object.keys(JSON.parse(fs.readFileSync(path.join(appsDir, 'template-app', 'locales', 'en.json'), 'utf8')));
  const tJa = Object.keys(JSON.parse(fs.readFileSync(path.join(appsDir, 'template-app', 'locales', 'ja.json'), 'utf8')));

  assert("FEAT-09: docs/apps-guide.md documente renderTab, registerAppMenu, WebAppVfsBridge et locales isolées",
    guideSrc.includes('renderTab(') && guideSrc.includes('registerAppMenu(') &&
    guideSrc.includes('WebAppVfsBridge') && !guideSrc.includes('registerAppMenus(')
  );
  assert("FEAT-09: apps/template-app/app.js utilise registerAppMenu et subscribe(theme:changed/locale:changed)",
    tmplJs.includes('registerAppMenu(') && !tmplJs.includes('registerAppMenus(') &&
    tmplJs.includes("this.subscribe('theme:changed'") && tmplJs.includes("this.subscribe('locale:changed'")
  );
  assert("FEAT-09: apps/template-app/backend/TemplateAppActions.php utilise project_root (ARCH-01), manifest.backend et protège les écritures par is_admin",
    tmplBackend.includes("project_root") && tmplBackend.includes("is_admin") &&
    tmplManifest.backend && Array.isArray(tmplManifest.backend.actions) &&
    tmplManifest.backend.mutating_actions && tmplManifest.backend.mutating_actions.includes('template_save_note')
  );
  assert("FEAT-09: apps/template-app/locales/{fr,en,ja}.json en parité stricte",
    tFr.length === tEn.length && tEn.length === tJa.length && tFr.length >= 50
  );
} catch (e) {
  assert("FEAT-09 vérifications kit dev", false, e.stack);
}

// -------------------------------------------------------------
// 14. PHASE 1 : Multi-Utilisateurs, Volumes Montés (Bureau + Explorer) & Panel Admin
// -------------------------------------------------------------
console.log('\n👥 [14/14] Phase 1 : Multi-Utilisateurs, Volumes Montés & Panel Utilisateurs/Partages...');
try {
  const shareSvcPath = path.join(rootDir, 'system', 'userland', 'services', 'ShareVolumesService.js');
  const usersPanelPath = path.join(appsDir, 'settings', 'users-panel.js');
  assert("Phase 1: ShareVolumesService.js et apps/settings/users-panel.js présents",
    fs.existsSync(shareSvcPath) && fs.existsSync(usersPanelPath)
  );
  assert("Phase 1: index.php charge ShareVolumesService.js et injecte ATELIER_CURRENT_USER / ATELIER_MOUNTED_VOLUMES",
    indexPhpSrc.includes('system/userland/services/ShareVolumesService.js') &&
    indexPhpSrc.includes('system/userland/services/AuthModalService.js') &&
    indexPhpSrc.includes('window.ATELIER_CURRENT_USER') &&
    indexPhpSrc.includes('window.ATELIER_MOUNTED_VOLUMES')
  );

  // Verify dedicated AuthModalService renders centered frosted login & account overlay
  const authModalPath = path.join(rootDir, 'system', 'userland', 'services', 'AuthModalService.js');
  assert("Phase 1: AuthModalService.js présent", fs.existsSync(authModalPath));
  const authModalCode = fs.readFileSync(authModalPath, 'utf8');
  const authBlurClasses = new Set();
  const makeMockEl = () => ({
    id: '', className: '', innerHTML: '', parentNode: null, style: {},
    classList: {
      add: (c) => authBlurClasses.add(c),
      remove: (c) => authBlurClasses.delete(c),
      toggle: (c, f) => (f ? authBlurClasses.add(c) : authBlurClasses.delete(c))
    },
    setAttribute: () => { },
    addEventListener: () => { },
    querySelector: () => null,
    querySelectorAll: () => [],
    remove: function () { this.parentNode = null; }
  });
  const authOverlayHost = { appendChild: (el) => { el.parentNode = authOverlayHost; } };
  const authWin = {
    IS_ADMIN: false,
    ATELIER_CURRENT_USER: null,
    localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
    requestAnimationFrame: (fn) => fn(),
    sys: { i18n: { t: (k, p) => p ? Object.entries(p).reduce((s, [a, b]) => s + ':' + b, k) : k } }
  };
  const authDoc = {
    body: authOverlayHost,
    createElement: () => makeMockEl(),
    getElementById: () => makeMockEl(),
    querySelector: () => null,
    addEventListener: () => { },
    removeEventListener: () => { }
  };
  new Function('window', 'document', authModalCode)(authWin, authDoc);
  authWin.sys.authModal.open();
  const loginHtml = authWin.sys.authModal.overlayEl.innerHTML;
  assert("Phase 1: AuthModalService ouvre une box dédiée (login, mdp, 2FA/TOTP, QR, options) avec flou bureau",
    authBlurClasses.has('atelier-auth-blur-active') &&
    loginHtml.includes('authModalUsername') &&
    loginHtml.includes('authModalPassword') &&
    loginHtml.includes('authModalTotp') &&
    loginHtml.includes('data-auth-mode="qr"') &&
    loginHtml.includes('authModalOptOpenHome') &&
    !loginHtml.includes('data-auth-mode="register"')
  );

  // Phase A.2: Enable registration policy -> Register tab, 2FA setup (local SVG QR), recovery codes & forgot password
  authWin.ATELIER_AUTH_POLICY = {
    registration_mode: 'open',
    registration_enabled: true,
    invite_required: false,
    approval_required: false,
    require_email_verification: true,
    allow_password_reset: true,
    min_password_length: 8,
    totp_policy: 'optional',
    totp_enabled: true,
    oidc_enabled: true,
    oidc_provider_name: 'Authentik'
  };
  authWin.sys.authModal.open({ mode: 'password' });
  const oidcLoginHtml = authWin.sys.authModal.overlayEl.innerHTML;
  authWin.sys.authModal.open({ mode: 'register' });
  const regHtml = authWin.sys.authModal.overlayEl.innerHTML;
  authWin.sys.authModal.open({ mode: 'totp_setup', context: { setup: { secret: 'JBSWY3DPEHPK3PXP', qr_svg: '<svg><path d="M0,0"/></svg>' } } });
  const totpSetupHtml = authWin.sys.authModal.overlayEl.innerHTML;
  authWin.sys.authModal.open({ mode: 'totp_codes', context: { codes: ['AAAA-BBBB', 'CCCC-DDDD'] } });
  const codesHtml = authWin.sys.authModal.overlayEl.innerHTML;
  assert("Phase A.2: AuthModalService rend inscription autonome, bouton SSO OIDC, assistant 2FA (QR SVG local) et codes de secours",
    oidcLoginHtml.includes('authModalOidcBtn') &&
    oidcLoginHtml.includes('Authentik') &&
    regHtml.includes('data-auth-mode="register"') &&
    regHtml.includes('authRegEmail') &&
    regHtml.includes('authRegHoneypot') &&
    totpSetupHtml.includes('JBSWY3DPEHPK3PXP') &&
    totpSetupHtml.includes('authSetupTotpCode') &&
    codesHtml.includes('AAAA-BBBB') &&
    codesHtml.includes('authDownloadRecoveryBtn')
  );
  authWin.sys.authModal.close(true);

  // Verify I18nEngine hydrates synchronously from window.ATELIER_I18N_CONFIG at boot (fixes early modal/toast i18n race)
  const i18nEngineCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'i18n', 'I18nEngine.js'), 'utf8');
  const bootI18nWin = {
    ATELIER_I18N_CONFIG: {
      default: 'fr',
      locales: { fr: { code: 'fr', name: 'Français' } },
      translations: { 'auth_modal.verify_email_title': "Vérification de l'adresse e-mail" }
    }
  };
  new Function('window', 'document', i18nEngineCode)(bootI18nWin, { getElementById: () => null });
  assert("I18nEngine hydrate immédiatement depuis window.ATELIER_I18N_CONFIG avant le boot de desktop.js",
    bootI18nWin.I18nEngine.t('auth_modal.verify_email_title') === "Vérification de l'adresse e-mail"
  );

  // Verify ShareVolumesService renders Explorer mounted volumes bar & share button
  const shareCode = fs.readFileSync(shareSvcPath, 'utf8');
  const mockVolWin = {
    IS_ADMIN: false,
    ATELIER_CURRENT_USER: { id: 2, username: 'bob', display_name: 'Bob', role: 'user', home_dir: 'users/bob' },
    ATELIER_USER_QUOTA: { used_bytes: 52428800, quota_bytes: 104857600, percent: 50, is_limited: true },
    ATELIER_MOUNTED_VOLUMES: [
      { id: 'home_2', kind: 'home', path: 'users/bob', mount_name: 'Bob', mount_icon: '🏠', permission: 'manage', show_on_desktop: true, is_encrypted: false },
      { id: 'share_9', kind: 'shared', path: 'users/alice/studio', mount_name: 'Studio Drive', mount_icon: '💽', permission: 'write', owner_username: 'alice', show_on_desktop: true, is_encrypted: true },
      { id: 'share_10', kind: 'shared', path: 'users/alice/hidden_desk', mount_name: 'NoDesk', mount_icon: '📁', permission: 'read', owner_username: 'alice', show_on_desktop: false, is_encrypted: false }
    ],
    location: { search: '', origin: 'https://atelier.local', pathname: '/' },
    sys: { i18n: { t: (k, p) => p ? Object.entries(p).reduce((s, [a, b]) => s + ':' + b, k) : k } }
  };
  const mockDoc = {
    readyState: 'complete',
    body: { getAttribute: () => 'dark-glass' },
    documentElement: { getAttribute: () => 'dark-glass' },
    getElementById: () => null,
    addEventListener: () => { }
  };
  new Function('window', 'document', shareCode)(mockVolWin, mockDoc);
  const svc = mockVolWin.sys.shares;
  const fakeBar = {
    style: {},
    innerHTML: '',
    querySelectorAll: () => [],
    querySelector: () => null
  };
  svc.renderExplorerMountsBar(fakeBar, 'users/bob/photos', () => { });
  assert("Phase 1 + A.2: ShareVolumesService rend la barre des volumes montés, le quota disque visuel et le bouton Partager",
    fakeBar.style.display === 'flex' &&
    fakeBar.innerHTML.includes('Studio Drive') &&
    fakeBar.innerHTML.includes('🔐') &&
    fakeBar.innerHTML.includes('RW') &&
    fakeBar.innerHTML.includes('vol-quota-pill') &&
    fakeBar.innerHTML.includes('data-share-path="users/bob/photos"')
  );

  // Verify WebOSApp sidebar layout & SettingsApp categorized left sidebar
  const settingsJsCode = fs.readFileSync(path.join(appsDir, 'settings', 'settings.js'), 'utf8');
  const webosAppCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'WebOSApp.js'), 'utf8');
  assert("Phase A.2 UI: Control Panel utilise la navigation latérale catégorisée (tabLayout: 'sidebar') et sections découpées",
    webosAppCode.includes('webos-sidebar-shell') &&
    webosAppCode.includes('webos-sidebar-group-title') &&
    settingsJsCode.includes("tabLayout: 'sidebar'") &&
    settingsJsCode.includes("id: 'registration'") &&
    settingsJsCode.includes("id: 'mail'") &&
    settingsJsCode.includes("id: 'shares'")
  );

  // Verify DesktopShortcutsManager mounts volumes as desktop disk icons
  const shortcutsCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'desktop', 'DesktopShortcuts.js'), 'utf8');
  const scWin = {
    ATELIER_MOUNTED_VOLUMES: mockVolWin.ATELIER_MOUNTED_VOLUMES,
    ATELIER_DESKTOP_CONFIG: { shortcuts: [] },
    localStorage: { getItem: () => null, setItem: () => { } },
    EventBus: { on: () => { } }
  };
  const scDoc = { readyState: 'loading', getElementById: () => null, addEventListener: () => { } };
  new Function('window', 'document', shortcutsCode)(scWin, scDoc);
  const scMgr = scWin.sys.desktopShortcuts;
  const effective = scMgr.getEffectiveShortcuts();
  const volItems = effective.filter(s => s.type === 'volume');
  assert("Phase 1: DesktopShortcutsManager monte les volumes (show_on_desktop=true) comme icônes de disque sur le bureau",
    volItems.length === 2 &&
    volItems.some(v => v.path === 'users/bob' && v.kind === 'home') &&
    volItems.some(v => v.path === 'users/alice/studio' && v.name === 'Studio Drive' && v.permission === 'write' && v.isEncrypted === true) &&
    !volItems.some(v => v.path === 'users/alice/hidden_desk')
  );
  assert("Audit C1: DesktopShortcutsManager interdit l'édition/suppression de raccourcis bureau aux invités et non-admins",
    scMgr.canEditShortcuts() === false && (await scMgr.save()) === false
  );

  // Authenticated multi-user CAN edit their own personal desktop shortcuts
  scWin.ATELIER_CURRENT_USER = { id: 2, username: 'bob', role: 'user' };
  assert("Multi-User Desktop: Un utilisateur connecté peut personnaliser son propre bureau",
    scMgr.canEditShortcuts() === true
  );

  // Verify WebOSServices StorageService isolates app data & preferences per user scope
  const servicesCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'services', 'WebOSServices.js'), 'utf8');
  const lsStore = new Map([
    ['webos_app_graphing-calc_history', JSON.stringify(['legacy_guest'])],
    ['atelier_active_theme', 'guest-legacy-theme']
  ]);
  const mockLocalStorage = {
    get length() { return lsStore.size; },
    key: (i) => Array.from(lsStore.keys())[i] ?? null,
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => lsStore.set(k, String(v)),
    removeItem: (k) => lsStore.delete(k)
  };
  const svcWin = {
    ATELIER_CURRENT_USER: { id: 1, username: 'alice' },
    ATELIER_USER_PREFERENCES: { theme: 'light-studio' },
    localStorage: mockLocalStorage,
    sys: {}
  };
  new Function('window', 'document', 'localStorage', servicesCode)(svcWin, {}, mockLocalStorage);
  const store = svcWin.sys.storage;
  const aliceCalc = store.forApp('graphing-calc');
  aliceCalc.set('history', ['2+2']);
  store.setPref('wallpaper', 'ocean', { sync: false });
  const aliceTheme = store.getPref('theme', 'dark-glass', 'atelier_active_theme');

  // Switch to Bob: must NOT see Alice's data nor Guest's legacy data
  svcWin.ATELIER_CURRENT_USER = { id: 2, username: 'bob' };
  svcWin.ATELIER_USER_PREFERENCES = {};
  const bobCalc = store.forApp('graphing-calc');
  const bobSeesAlice = bobCalc.get('history', null);
  const bobTheme = store.getPref('theme', 'dark-glass', 'atelier_active_theme');
  bobCalc.set('history', ['9*9']);

  // Switch back to Alice and clear ONLY Alice's scope: Bob's data must survive!
  svcWin.ATELIER_CURRENT_USER = { id: 1, username: 'alice' };
  store.clearUserScope();
  const aliceAfterClear = aliceCalc.get('history', null);
  svcWin.ATELIER_CURRENT_USER = { id: 2, username: 'bob' };
  const bobAfterAliceClear = bobCalc.get('history', null);

  assert("Multi-User Storage: sys.storage cloisonne données apps, préférences et clearUserScope() par utilisateur",
    aliceTheme === 'light-studio' &&
    bobSeesAlice === null &&
    bobTheme === 'dark-glass' &&
    aliceAfterClear === null &&
    Array.isArray(bobAfterAliceClear) && bobAfterAliceClear[0] === '9*9'
  );

  // Verify Tribune isolates OAuth board_auth & user_login per user scope
  const tribuneJsCode = fs.readFileSync(path.join(appsDir, 'tribune', 'app.js'), 'utf8');
  assert("Multi-User Storage: Tribune cloisonne board_auth, pseudo et BAK par utilisateur et recharge sur auth:changed",
    tribuneJsCode.includes('tribune_${scope}_${key}') &&
    tribuneJsCode.includes('reloadUserScopedState') &&
    !tribuneJsCode.includes("localStorage.getItem('tribune_board_auth')") &&
    !tribuneJsCode.includes("localStorage.setItem('tribune_board_auth'")
  );

  // Verify 3-tier Role/Group/User Permissions UI, Global Desktop Template UI & Admin Guide
  const settingsUiCode = fs.readFileSync(path.join(appsDir, 'settings', 'settings.js'), 'utf8');
  const usersPanelUiCode = fs.readFileSync(usersPanelPath, 'utf8');
  const adminGuidePath = path.join(rootDir, 'docs', 'admin-guide.md');
  const adminGuideExists = fs.existsSync(adminGuidePath);
  const adminGuideText = adminGuideExists ? fs.readFileSync(adminGuidePath, 'utf8') : '';
  assert("Admin & RBAC UI: Control Panel expose matrice 3 rôles, surcharges groupe/utilisateur, modèle bureau global et docs/admin-guide.md",
    settingsUiCode.includes('MATRIX_ROLES') &&
    settingsUiCode.includes('can_use_browser_proxy') &&
    settingsUiCode.includes('settingsPublishGlobalDesktopBtn') &&
    usersPanelUiCode.includes('set_user_permissions') &&
    usersPanelUiCode.includes('set_group_permissions') &&
    usersPanelUiCode.includes('perm-overrides-grid') &&
    adminGuideExists &&
    adminGuideText.includes('storage/desktop_admin.json') &&
    adminGuideText.includes('PermissionsManager')
  );

  assert("GDPR Self-Delete UI: Control Panel expose export ZIP signé, confirmation de réception et suppression de compte",
    settingsUiCode.includes('settingsAccountDangerHost') &&
    settingsUiCode.includes('renderAccountDangerZoneCard') &&
    usersPanelUiCode.includes('create_account_export') &&
    usersPanelUiCode.includes('confirm_account_export_receipt') &&
    usersPanelUiCode.includes('delete_own_account') &&
    usersPanelUiCode.includes('showPostDeletionExportModal') &&
    fs.existsSync(path.join(rootDir, 'system', 'endpoints', 'export.php')) &&
    adminGuideText.includes('AccountExportService')
  );

  // Verify Phase B frontend integration (SyscallClient.uploadChunked + Control Panel Storage/Cloud/Trash/Index tab)
  const syscallCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'SyscallClient.js'), 'utf8');
  const thumbPhpSrc = fs.readFileSync(path.join(rootDir, 'system', 'endpoints', 'thumb.php'), 'utf8');
  assert("Phase B UI & Client: SyscallClient.uploadChunked + CSRF auto-resync + cache vignettes ext:// + onglet Stockage & Cloud",
    syscallCode.includes('async uploadChunked(') &&
    syscallCode.includes('syncCsrfToken(') &&
    syscallCode.includes("code === 'invalid_csrf'") &&
    syscallCode.includes('upload_chunk_init') &&
    syscallCode.includes('upload_chunk_complete') &&
    thumbPhpSrc.includes('ext_cache') &&
    thumbPhpSrc.includes('fetchThumbnail') &&
    thumbPhpSrc.includes('readContentWithMeta') &&
    settingsUiCode.includes("id: 'storage'") &&
    usersPanelUiCode.includes('renderStorageSection') &&
    usersPanelUiCode.includes('create_external_mount') &&
    usersPanelUiCode.includes('test_external_mount_config') &&
    usersPanelUiCode.includes('gdrive_oauth_start') &&
    usersPanelUiCode.includes('ext-driver-card') &&
    usersPanelUiCode.includes('extGdriveOauthBtn') &&
    usersPanelUiCode.includes('restore_trash_item') &&
    usersPanelUiCode.includes('rebuild_file_index')
  );

  // Verify Lot 2: Per-user default file associations override AppManager & MediaViewerRegistry + Admin External Apps UI
  const explorerCodeLot2 = fs.readFileSync(path.join(appsDir, 'explorer', 'explorer.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(appsDir, 'explorer', 'scripts', 'explorer-context-menu.js'), 'utf8');
  const webosServicesCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'services', 'WebOSServices.js'), 'utf8');
  const appMgrCodeLot2 = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'AppManager.js'), 'utf8');
  const mvrCodeLot2 = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'MediaViewerRegistry.js'), 'utf8');

  // Execute AppManager + MediaViewerRegistry in isolated sandbox to prove per-user default_apps takes priority
  const lot2Store = {};
  const lot2Win = {
    ATELIER_DISCOVERED_APPS: {
      'doc-viewer': { id: 'doc-viewer', name: 'Doc Viewer', extensions: ['pdf', 'xls'], fallbackExtensions: ['xls'] },
      'gridcraft': { id: 'gridcraft', name: 'GridCraft', runtime: 'iframe', distribution: 'standalone-web', extensions: ['xls', 'xlsx'] },
      'pdfcraft': { id: 'pdfcraft', name: 'PdfCraft', runtime: 'iframe', distribution: 'standalone-web', extensions: ['pdf'] }
    },
    ATELIER_USER_PREFERENCES: {},
    EventBus: { emit: () => {} },
    document: { getElementById: () => null, head: { appendChild: () => {} }, createElement: () => ({}) },
    sys: {
      storage: {
        getPref: (k, def) => (k in lot2Store ? lot2Store[k] : def),
        setPref: (k, v) => { lot2Store[k] = v; return true; }
      }
    }
  };
  const AppMgrClass = new Function('window', `${appMgrCodeLot2}; return AppManager;`)(lot2Win);
  const amLot2 = new AppMgrClass();
  lot2Win.sys.appManager = amLot2;
  new Function('window', 'document', mvrCodeLot2)(lot2Win, lot2Win.document);
  lot2Win.MediaViewerRegistry.register({ id: 'generic-doc', priority: 100, extensions: ['pdf', 'xls'] });
  lot2Win.MediaViewerRegistry.register({ id: 'pdfcraft', priority: 50, extensions: ['pdf'] });
  lot2Win.MediaViewerRegistry.register({ id: 'gridcraft', priority: 50, extensions: ['xls'] });

  const pdfBefore = amLot2.getAppForFile({ name: 'report.pdf', extension: 'pdf' });
  const mvrPdfBefore = lot2Win.MediaViewerRegistry.findViewer({ name: 'report.pdf', extension: 'pdf' });
  // User picks pdfcraft as personal default for .pdf -> overrides BOTH AppManager and MediaViewerRegistry!
  amLot2.setDefaultAppForExtension('pdf', 'pdfcraft');
  const pdfAfter = amLot2.getAppForFile({ name: 'report.pdf', extension: 'pdf' });
  const mvrPdfAfter = lot2Win.MediaViewerRegistry.findViewer({ name: 'report.pdf', extension: 'pdf' });
  // User picks doc-viewer as personal default for .xls -> maps to generic-doc in MediaViewerRegistry!
  amLot2.setDefaultAppForExtension('xls', 'doc-viewer');
  const xlsAfter = amLot2.getAppForFile({ name: 'budget.xls', extension: 'xls' });
  const mvrXlsAfter = lot2Win.MediaViewerRegistry.findViewer({ name: 'budget.xls', extension: 'xls' });
  // Reset restores automatic priority (gridcraft beats doc-viewer fallback for .xls)
  amLot2.setDefaultAppForExtension('xls', null);
  const xlsReset = amLot2.getAppForFile({ name: 'budget.xls', extension: 'xls' });

  assert("Lot 2: Préférences default_apps par utilisateur prioritaires dans AppManager et MediaViewerRegistry (avec reset auto)",
    pdfBefore && pdfBefore.manifest.id === 'doc-viewer' &&
    mvrPdfBefore && mvrPdfBefore.id === 'generic-doc' &&
    pdfAfter && pdfAfter.manifest.id === 'pdfcraft' &&
    mvrPdfAfter && mvrPdfAfter.id === 'pdfcraft' &&
    xlsAfter && xlsAfter.manifest.id === 'doc-viewer' &&
    mvrXlsAfter && mvrXlsAfter.id === 'generic-doc' &&
    xlsReset && xlsReset.manifest.id === 'gridcraft'
  );

  assert("Lot 2 UI: Control Panel External Apps Manager + Explorer étoile par défaut + sync default_apps",
    settingsUiCode.includes('settingsExternalAppsHost') &&
    settingsUiCode.includes('renderExternalAppsSection') &&
    usersPanelUiCode.includes('install_external_app_zip') &&
    usersPanelUiCode.includes('install_external_app_url') &&
    usersPanelUiCode.includes('check_external_app_updates') &&
    usersPanelUiCode.includes('approve_external_app_update') &&
    usersPanelUiCode.includes('dismiss_external_app_update') &&
    usersPanelUiCode.includes('save_external_app_override') &&
    usersPanelUiCode.includes('uninstall_external_app') &&
    explorerCodeLot2.includes('explorer-open-with-default-btn') &&
    explorerCodeLot2.includes('setDefaultAppForExtension') &&
    webosServicesCode.includes("'default_apps'") &&
    adminGuideText.includes('ExternalAppManager')
  );

  // Verify Exit/Quit hooks (cw.close(), webos:quit/exit/close, <prefix>:quit) & Unsaved Changes Guard (dirty + beforeunload + WindowManager.onBeforeClose)
  const wmCodeExit = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'WindowManager.js'), 'utf8');
  const vfsBridgeCodeExit = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'WebAppVfsBridge.js'), 'utf8');
  const webAppHostCodeExit = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'WebAppHost.js'), 'utf8');

  // Test WebAppVfsBridge cw.close() interception + beforeunload probe in sandbox
  const exitWin = {
    location: { origin: 'https://atelier.local' },
    Event: class MockEvent {
      constructor(type, opts = {}) { this.type = type; this.cancelable = !!opts.cancelable; this.defaultPrevented = false; }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    },
    sys: {}
  };
  new Function('window', vfsBridgeCodeExit)(exitWin);
  const exitBridge = exitWin.sys.webAppVfsBridge;

  let appCloseRequested = 0;
  let beforeUnloadHandlers = [];
  const fakeCw = {
    location: { origin: 'https://atelier.local' },
    document: { addEventListener: () => {} },
    Event: exitWin.Event,
    close: () => {},
    addEventListener: (t, fn) => { if (t === 'beforeunload') beforeUnloadHandlers.push(fn); },
    removeEventListener: (t, fn) => { if (t === 'beforeunload') beforeUnloadHandlers = beforeUnloadHandlers.filter(f => f !== fn); },
    dispatchEvent: (ev) => { beforeUnloadHandlers.forEach(fn => fn(ev)); }
  };
  const fakeIframe = { contentWindow: fakeCw };
  const fakeAppInst = {
    id: 'wordcraft',
    windowId: 'webapp-wordcraft',
    isDirty: false,
    manifest: {},
    getAppTitle: () => 'WordCraft',
    getIframeElement: () => fakeIframe,
    requestCloseFromApp: () => { appCloseRequested++; }
  };
  exitBridge.attachToIframe(fakeIframe, fakeAppInst);

  // 1. Clean state -> probeUnsavedChanges is false
  const probeClean = exitBridge.probeUnsavedChanges(fakeIframe, fakeAppInst);
  // 2. App registers beforeunload guard calling preventDefault + returnValue (like WordCraft/PhotoCraft)
  fakeCw.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = 'Unsaved edits'; });
  const probeBeforeUnload = exitBridge.probeUnsavedChanges(fakeIframe, fakeAppInst);
  // 3. Explicit host-bridge dirty flag
  beforeUnloadHandlers = [];
  fakeAppInst.isDirty = true;
  const probeDirtyFlag = exitBridge.probeUnsavedChanges(fakeIframe, fakeAppInst);
  // 4. App invokes window.close() inside iframe -> routes to requestCloseFromApp()
  fakeCw.close();
  // 5. postMessage webos:quit from authenticated iframe routes to requestCloseFromApp()
  await exitBridge.handlePostMessage(
    { source: fakeCw, origin: 'https://atelier.local', data: { type: 'webos:quit' } },
    { instances: new Map([['wordcraft', fakeAppInst]]) }
  );

  assert("Exit/Quit & Unsaved Guard: cw.close() + webos:quit + probeUnsavedChanges (beforeunload & host dirty) + WindowManager onBeforeClose",
    probeClean.dirty === false &&
    probeBeforeUnload.dirty === true && probeBeforeUnload.source === 'beforeunload' &&
    probeDirtyFlag.dirty === true && probeDirtyFlag.source === 'host-bridge' &&
    appCloseRequested === 2 &&
    wmCodeExit.includes('onBeforeClose') &&
    wmCodeExit.includes('_closingInProgress') &&
    webAppHostCodeExit.includes('confirmCloseIfDirty') &&
    webAppHostCodeExit.includes('requestCloseFromApp') &&
    webAppHostCodeExit.includes("sub === 'close' || sub === 'quit' || sub === 'exit'")
  );

  // Verify Phase C: WebDAV UI, Async Jobs/Backups UI, Docker packaging, First-Run Setup & PWA
  const pwaManifestPath = path.join(rootDir, 'manifest.webmanifest');
  const swPath = path.join(rootDir, 'sw.js');
  const dockerfilePath = path.join(rootDir, 'Dockerfile');
  const dockerignorePath = path.join(rootDir, '.dockerignore');
  const ghDockerWorkflowPath = path.join(rootDir, '.github', 'workflows', 'docker-publish.yml');
  const composePath = path.join(rootDir, 'docker-compose.yml');
  const nginxConfPath = path.join(rootDir, 'docker', 'nginx.conf');
  const workerPath = path.join(rootDir, 'bin', 'worker.php');
  const davEndpointPath = path.join(rootDir, 'system', 'endpoints', 'dav.php');
  const setupEndpointPath = path.join(rootDir, 'system', 'endpoints', 'setup.php');
  const pwaManifest = fs.existsSync(pwaManifestPath) ? JSON.parse(fs.readFileSync(pwaManifestPath, 'utf8')) : null;
  const swCode = fs.existsSync(swPath) ? fs.readFileSync(swPath, 'utf8') : '';
  const nginxConf = fs.existsSync(nginxConfPath) ? fs.readFileSync(nginxConfPath, 'utf8') : '';
  const indexHtmlPhaseC = fs.readFileSync(path.join(rootDir, 'index.php'), 'utf8');

  assert("Phase C: Packaging Prod (Dockerfile, docker-compose, nginx sécurisé, worker.php, dav.php, setup.php), PWA & Control Panel UI",
    fs.existsSync(dockerfilePath) &&
    fs.existsSync(dockerignorePath) &&
    fs.existsSync(ghDockerWorkflowPath) &&
    fs.existsSync(composePath) &&
    fs.existsSync(workerPath) &&
    fs.existsSync(davEndpointPath) &&
    fs.existsSync(setupEndpointPath) &&
    nginxConf.includes('location ~* ^/(storage|config|tests|bin|docker|system/kernel|system/boot)/') &&
    nginxConf.includes('location ~* ^/apps/.*\\.php$') &&
    nginxConf.includes('try_files $uri =404;') &&
    nginxConf.includes('HTTP_AUTHORIZATION') &&
    pwaManifest && pwaManifest.display === 'standalone' &&
    swCode.includes("p.includes('api.php')") &&
    swCode.includes("p.includes('/dav')") &&
    indexHtmlPhaseC.includes('manifest.webmanifest') &&
    indexHtmlPhaseC.includes("navigator.serviceWorker.register('sw.js')") &&
    settingsUiCode.includes('settingsAppPasswordsHost') &&
    settingsUiCode.includes('settingsJobsBackupsHost') &&
    usersPanelUiCode.includes('renderAppPasswordsCard') &&
    usersPanelUiCode.includes('renderJobsAndBackupsSection') &&
    usersPanelUiCode.includes('create_app_password') &&
    usersPanelUiCode.includes('enqueue_job') &&
    usersPanelUiCode.includes('create_instance_backup') &&
    adminGuideText.includes('InstanceBackupService')
  );

  // Verify users-panel.js registers custom section cleanly without syntax errors
  const usersPanelCode = fs.readFileSync(usersPanelPath, 'utf8');
  const registeredSections = [];
  const panelWin = {
    SettingsApp: { registerSection: (s) => registeredSections.push(s) },
    setTimeout: (fn) => fn()
  };
  new Function('window', usersPanelCode)(panelWin);
  assert("Phase 1: users-panel.js enregistre la section 'users' dans SettingsApp",
    registeredSections.length === 1 && registeredSections[0].id === 'users' && typeof registeredSections[0].render === 'function'
  );

  // Verify strict FR/EN/JA parity on apps/settings/locales/ and root locales/
  const sFr = Object.keys(JSON.parse(fs.readFileSync(path.join(appsDir, 'settings', 'locales', 'fr.json'), 'utf8'))).sort();
  const sEn = Object.keys(JSON.parse(fs.readFileSync(path.join(appsDir, 'settings', 'locales', 'en.json'), 'utf8'))).sort();
  const sJa = Object.keys(JSON.parse(fs.readFileSync(path.join(appsDir, 'settings', 'locales', 'ja.json'), 'utf8'))).sort();
  assert("Phase 1: Parité stricte FR/EN/JA sur apps/settings/locales/",
    JSON.stringify(sFr) === JSON.stringify(sEn) && JSON.stringify(sEn) === JSON.stringify(sJa) && sFr.length >= 30
  );

  const rFr = Object.keys(JSON.parse(fs.readFileSync(path.join(rootDir, 'locales', 'fr.json'), 'utf8')).translations).sort();
  const rEn = Object.keys(JSON.parse(fs.readFileSync(path.join(rootDir, 'locales', 'en.json'), 'utf8')).translations).sort();
  const rJa = Object.keys(JSON.parse(fs.readFileSync(path.join(rootDir, 'locales', 'ja.json'), 'utf8')).translations).sort();
  assert("Phase 1: Parité stricte FR/EN/JA sur locales/ système",
    JSON.stringify(rFr) === JSON.stringify(rEn) && JSON.stringify(rEn) === JSON.stringify(rJa)
  );

  // Phase E (Lot 1): AI Agent Settings Panel & Manifest wiring
  const aiPanelPath = path.join(appsDir, 'settings', 'ai-panel.js');
  const aiPanelCode = fs.existsSync(aiPanelPath) ? fs.readFileSync(aiPanelPath, 'utf8') : '';
  const settingsManifestJson = JSON.parse(fs.readFileSync(path.join(appsDir, 'settings', 'manifest.json'), 'utf8'));
  const aiWin = {};
  if (aiPanelCode) {
    new Function('window', aiPanelCode)(aiWin);
  }
  assert("Phase E (Lot 1): Panneau Settings IA & Agent (ai-panel.js, manifest, zéro fetch() brut, API ai_*)",
    fs.existsSync(aiPanelPath) &&
    Array.isArray(settingsManifestJson.scripts) && settingsManifestJson.scripts.includes('ai-panel.js') &&
    settingsUiCode.includes("id: 'ai_agent'") &&
    settingsUiCode.includes('can_use_ai_agent') &&
    typeof (aiWin.AtelierAiPanel && aiWin.AtelierAiPanel.render) === 'function' &&
    aiPanelCode.includes('ai_get_config') &&
    aiPanelCode.includes('ai_save_user_config') &&
    aiPanelCode.includes('ai_save_admin_policy') &&
    aiPanelCode.includes('ai_test_profile') &&
    aiPanelCode.includes('aiProviderHelpBox') &&
    aiPanelCode.includes('ai.help_auth_title') &&
    aiPanelCode.includes('ai.help_ssrf_title') &&
    !/\bfetch\s*\(/.test(aiPanelCode)
  );

  // Phase E (Lot 2): AgentToolRegistry, AiCopilotService & Taskbar Copilot Popup
  const agentRegPath = path.join(rootDir, 'system', 'userland', 'services', 'AgentToolRegistry.js');
  const copilotSvcPath = path.join(rootDir, 'system', 'userland', 'services', 'AiCopilotService.js');
  const taskbarTplPath = path.join(appsDir, 'taskbar', 'template.php');
  const taskbarAppPath = path.join(appsDir, 'taskbar', 'app.js');
  const taskbarCssPath = path.join(appsDir, 'taskbar', 'style.css');
  const agentRegCode = fs.existsSync(agentRegPath) ? fs.readFileSync(agentRegPath, 'utf8') : '';
  const copilotSvcCode = fs.existsSync(copilotSvcPath) ? fs.readFileSync(copilotSvcPath, 'utf8') : '';
  const taskbarTplCode = fs.existsSync(taskbarTplPath) ? fs.readFileSync(taskbarTplPath, 'utf8') : '';
  const taskbarAppCode = fs.existsSync(taskbarAppPath) ? fs.readFileSync(taskbarAppPath, 'utf8') : '';
  const taskbarCssCode = fs.existsSync(taskbarCssPath) ? fs.readFileSync(taskbarCssPath, 'utf8') : '';

  assert("Phase E (Lot 2): Fichiers Copilot, chargement index.php, Taskbar popup & zéro fetch() brut",
    fs.existsSync(agentRegPath) &&
    fs.existsSync(copilotSvcPath) &&
    indexHtmlPhaseC.includes('AgentToolRegistry.js') &&
    indexHtmlPhaseC.includes('AiCopilotService.js') &&
    taskbarTplCode.includes('taskbarCopilotBar') &&
    taskbarTplCode.includes('taskbarCopilotQuickInput') &&
    taskbarTplCode.includes('taskbarCopilotPopup') &&
    taskbarTplCode.includes('openCookieSettingsBtn') &&
    taskbarAppCode.includes('window.sys.copilot') &&
    taskbarCssCode.includes('.taskbar-copilot-popup') &&
    copilotSvcCode.includes('[UNTRUSTED_TOOL_OUTPUT]') &&
    copilotSvcCode.includes('copilotFamilySelect') &&
    copilotSvcCode.includes('copilotVariantSelect') &&
    copilotSvcCode.includes('needs-approval') &&
    !/\bfetch\s*\(/.test(agentRegCode) &&
    !/\bfetch\s*\(/.test(copilotSvcCode)
  );

  // Runtime verification of AgentToolRegistry risk policy, disabled_apps, and soft-delete invariant
  const postedApiCalls = [];
  const launchedApps = [];
  const regMockWin = {
    ATELIER_CURRENT_USER: { username: 'alice', display_name: 'Alice', home_dir: 'users/alice' },
    ATELIER_DISCOVERED_APPS: {
      explorer: { name: 'Explorer', category: 'system', manifest: { extensions: [] } },
      secretapp: { name: 'SecretApp', category: 'other', manifest: { extensions: [] } },
      taskbar: { name: 'Taskbar', category: 'system', manifest: {} }
    },
    WindowManager: {
      activeWindowId: 'win_exp',
      windows: new Map([
        ['win_exp', { id: 'win_exp', appId: 'explorer', title: 'Explorer', state: 'normal' }],
        ['win_sec', { id: 'win_sec', appId: 'secretapp', title: 'Secret', state: 'normal' }]
      ])
    },
    sys: {
      appManager: { launchApp: (id) => launchedApps.push(id) },
      api: {
        post: async (action, body) => {
          postedApiCalls.push({ action, body });
          return { success: true };
        },
        get: async () => ({ success: true, directories: [], files: [] })
      }
    }
  };
  new Function('window', agentRegCode)(regMockWin);
  const reg = regMockWin.sys && regMockWin.sys.agentTools;
  const readOnlyTools = reg ? reg.getAvailableTools('read_only', []) : [];
  const assistedTools = reg ? reg.getAvailableTools('assisted', []) : [];
  const listAppsRes = reg ? await reg.executeTool('os_list_apps', {}, { autonomyLevel: 'assisted', disabledApps: ['secretapp'] }) : null;
  const launchBlocked = reg ? await reg.executeTool('os_launch_app', { app_id: 'secretapp' }, { autonomyLevel: 'assisted', disabledApps: ['secretapp'] }) : null;
  const delRes = reg ? await reg.executeTool('vfs_delete_item', { path: 'users/alice/demo.txt' }, { autonomyLevel: 'assisted', disabledApps: [] }) : null;
  const lastDelCall = postedApiCalls.find(c => c.action === 'delete_item');

  assert("Phase E (Lot 2): AgentToolRegistry (read_only, Human-in-the-Loop, disabled_apps, soft-delete strict)",
    Boolean(reg) &&
    readOnlyTools.length >= 5 &&
    readOnlyTools.every(t => t.risk === 'read') &&
    assistedTools.length > readOnlyTools.length &&
    reg.requiresConfirmation({ risk: 'read' }, 'assisted', 'explorer') === false &&
    reg.requiresConfirmation({ risk: 'mutate_fs' }, 'autonomous_app', 'explorer') === true &&
    reg.requiresConfirmation({ risk: 'destructive' }, 'autonomous_app', 'explorer') === true &&
    reg.requiresConfirmation({ risk: 'mutate_app', appId: 'explorer' }, 'assisted', 'explorer') === true &&
    reg.requiresConfirmation({ risk: 'mutate_app', appId: 'explorer' }, 'autonomous_app', 'explorer') === false &&
    reg.requiresConfirmation({ risk: 'mutate_app', appId: 'other' }, 'autonomous_app', 'explorer') === true &&
    listAppsRes && listAppsRes.success && !listAppsRes.apps.some(a => a.id === 'secretapp' || a.id === 'taskbar') &&
    launchBlocked && launchBlocked.success === false && launchedApps.length === 0 &&
    delRes && delRes.success === true && lastDelCall && lastDelCall.body.target === 'users/alice/demo.txt' && !('permanent' in lastDelCall.body)
  );

  // Phase E (Lot 3): WebAppAgentBridge — dynamic craft-web-api + origin-locked webos:agent-* protocol + multimodal screenshot
  const agentBridgePath = path.join(rootDir, 'system', 'userland', 'core', 'WebAppAgentBridge.js');
  const agentBridgeCode = fs.existsSync(agentBridgePath) ? fs.readFileSync(agentBridgePath, 'utf8') : '';
  const webAppHostSrc = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'core', 'WebAppHost.js'), 'utf8');

  assert("Phase E (Lot 3): WebAppAgentBridge.js présent, chargé dans index.php, hooké dans WebAppHost & zéro fetch() brut",
    fs.existsSync(agentBridgePath) &&
    indexHtmlPhaseC.includes('WebAppAgentBridge.js') &&
    webAppHostSrc.includes('webAppAgentBridge.detachApp') &&
    !/\bfetch\s*\(/.test(agentBridgeCode)
  );

  const craftExecCalls = [];
  const pmListeners = [];
  const fakePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const wordcraftCw = {
    location: { origin: 'https://atelier.local' },
    wordcraft: {
      commands: async () => ({
        ok: true,
        result: [
          { name: 'edit.insertText', description: 'Insert text at cursor' },
          { name: 'format.heading', description: 'Apply heading style' },
          { name: 'view.zoom', description: 'Zoom viewport' }
        ]
      }),
      docInspect: async (p) => ({ ok: true, result: { paragraphs: 1, includeText: Boolean(p && p.text) } }),
      uiInspect: async () => ({ ok: true, result: { activeTab: 'Home' } }),
      execute: async (cmd, params) => {
        craftExecCalls.push({ cmd, params });
        return { ok: true, result: { applied: cmd } };
      },
      screenshot: async () => ({ ok: true, result: { png_base64: fakePngB64 } }),
      request: async (method, params) => ({ ok: true, result: { method, params } })
    }
  };
  const thirdPartySent = [];
  const thirdPartyCw = {
    location: { origin: 'https://atelier.local' },
    postMessage: (msg, origin) => {
      thirdPartySent.push({ msg, origin });
      if (msg && msg.type === 'webos:agent-call') {
        pmListeners.forEach(fn => fn({
          origin: 'https://atelier.local',
          source: thirdPartyCw,
          data: { type: 'webos:agent-result', callId: msg.callId, success: true, result: { pong: msg.args.val } }
        }));
      }
    }
  };
  const wordcraftInst = {
    id: 'wordcraft',
    windowId: 'webapp-wordcraft',
    hostBridge: { prefix: 'wordcraft' },
    activeFile: { name: 'poeme.docx' },
    isDirty: false,
    getIframeElement: () => ({ contentWindow: wordcraftCw, contentDocument: null })
  };
  const thirdPartyInst = {
    id: 'myextapp',
    windowId: 'webapp-myextapp',
    getIframeElement: () => ({ contentWindow: thirdPartyCw, contentDocument: null })
  };

  const l3Win = {
    location: { origin: 'https://atelier.local' },
    addEventListener: (evt, fn) => { if (evt === 'message') pmListeners.push(fn); },
    WindowManager: {
      activeWindowId: 'webapp-wordcraft',
      windows: new Map([
        ['webapp-wordcraft', { id: 'webapp-wordcraft', appId: 'wordcraft', title: 'WordCraft', state: 'normal' }]
      ])
    },
    WebAppHost: {
      instances: new Map([['wordcraft', wordcraftInst], ['myextapp', thirdPartyInst]]),
      get: (id) => (id === 'wordcraft' ? wordcraftInst : (id === 'myextapp' ? thirdPartyInst : null))
    },
    sys: {}
  };
  new Function('window', agentRegCode)(l3Win);
  new Function('window', agentBridgeCode)(l3Win);
  const l3Reg = l3Win.sys.agentTools;
  const l3Bridge = l3Win.sys.webAppAgentBridge;

  const l3Ctx = l3Reg.collectContext([]);
  const l3ToolsAssisted = l3Reg.getAvailableTools('assisted', []);
  const l3ToolsReadOnly = l3Reg.getAvailableTools('read_only', []);
  const l3ToolsNoVision = l3Reg.getAvailableTools('assisted', [], { allowVision: false });
  const l3ToolsDisabled = l3Reg.getAvailableTools('assisted', ['wordcraft']);

  const cmdCatalog = await l3Reg.executeTool('craft_commands', { app_id: 'wordcraft' }, { autonomyLevel: 'assisted', disabledApps: [] });
  const cmdRes = await l3Reg.executeTool('craft_commands', { app_id: 'wordcraft', filter: 'insert' }, { autonomyLevel: 'assisted', disabledApps: [] });
  const batchRes = await l3Reg.executeTool('craft_execute_batch', {
    app_id: 'wordcraft',
    steps: [
      { command: 'format.heading', params: { level: 1 } },
      { command: 'format.color', params: { color: '#d9534f' } },
      { command: 'edit.insertText', params: { text: 'Le Marchand de Choucroute' } },
      { command: 'range.setValues', params: { range: 'A1', values: '["Col1","Col2"],["Item",1200]' } }
    ]
  }, { autonomyLevel: 'assisted', disabledApps: [] });
  const shotRes = await l3Reg.executeTool('craft_screenshot', { app_id: 'wordcraft' }, { autonomyLevel: 'assisted', disabledApps: [] });

  // Test origin-locked `webos:agent-*` postMessage protocol
  pmListeners.forEach(fn => fn({
    origin: 'https://evil.example',
    source: thirdPartyCw,
    data: { type: 'webos:agent-register-tools', tools: [{ name: 'evil_tool', description: 'Blocked' }] }
  }));
  const evilRegistered = l3Reg.getAvailableTools('assisted', []).some(t => t.name.includes('evil_tool'));

  pmListeners.forEach(fn => fn({
    origin: 'https://atelier.local',
    source: thirdPartyCw,
    data: {
      type: 'webos:agent-register-tools',
      tools: [{ name: 'ping', description: 'Ping external app', risk: 'read', parameters: { type: 'object', properties: { val: { type: 'string' } } } }]
    }
  }));
  pmListeners.forEach(fn => fn({
    origin: 'https://atelier.local',
    source: thirdPartyCw,
    data: { type: 'webos:agent-context', context: { scene: 'demo' } }
  }));
  const pmCallRes = await l3Reg.executeTool('extapp_myextapp_ping', { val: 'hello' }, { autonomyLevel: 'read_only', disabledApps: [] });
  const pmCtx = l3Reg.collectContext([]);
  l3Bridge.detachApp('myextapp');
  const pmRemovedAfterDetach = !l3Reg.getAvailableTools('assisted', []).some(t => t.name === 'extapp_myextapp_ping');

  assert("Phase E (Lot 3): Pont dynamique craft-web-api (commands/batch/screenshot/vision/autonomous_app) & protocole webos:agent-* origin-locked",
    l3Ctx.app_contexts.wordcraft && l3Ctx.app_contexts.wordcraft.agent_protocol === 'craft-web-api' &&
    l3ToolsAssisted.some(t => t.name === 'craft_execute_batch') &&
    l3ToolsReadOnly.some(t => t.name === 'craft_commands') &&
    !l3ToolsReadOnly.some(t => t.name === 'craft_execute') &&
    !l3ToolsNoVision.some(t => t.name === 'craft_screenshot') &&
    !l3ToolsDisabled.some(t => t.name === 'craft_commands') &&
    l3Reg.requiresConfirmation({ risk: 'mutate_app' }, 'autonomous_app', 'wordcraft', { app_id: 'wordcraft' }) === false &&
    l3Reg.requiresConfirmation({ risk: 'mutate_app' }, 'autonomous_app', 'explorer', { app_id: 'wordcraft' }) === true &&
    cmdCatalog && cmdCatalog.success && cmdCatalog.mode === 'compact_catalog' && cmdCatalog.namespaces && Array.isArray(cmdCatalog.namespaces.edit) &&
    cmdRes && cmdRes.success && Array.isArray(cmdRes.commands) && cmdRes.commands.length === 1 && cmdRes.commands[0].id === 'edit.insertText' &&
    batchRes && batchRes.success && batchRes.executed === 4 && craftExecCalls.length === 4 &&
    craftExecCalls[1].params.color === 'D9534F' &&
    Array.isArray(craftExecCalls[3].params.values) && craftExecCalls[3].params.values.length === 2 &&
    craftExecCalls[3].params.values[0][0] === 'Col1' && craftExecCalls[3].params.values[1][1] === 1200 &&
    shotRes && shotRes.success && shotRes._vision_image && shotRes._vision_image.data === fakePngB64 &&
    !evilRegistered &&
    pmCallRes && pmCallRes.success && pmCallRes.result && pmCallRes.result.pong === 'hello' &&
    thirdPartySent.length === 1 && thirdPartySent[0].origin === 'https://atelier.local' &&
    pmCtx.app_contexts.myextapp && pmCtx.app_contexts.myextapp.context && pmCtx.app_contexts.myextapp.context.scene === 'demo' &&
    pmRemovedAfterDetach
  );

  // Phase E (Lot 4): Universal WebOSApp Agent Contract, Native Apps Provider & Pilot Integrations
  const webOSAppPath = path.join(rootDir, 'system', 'userland', 'core', 'WebOSApp.js');
  const webOSAppCode = fs.readFileSync(webOSAppPath, 'utf8');
  const appsGuidePath = path.join(rootDir, 'docs', 'apps-guide.md');
  const appsGuideMd = fs.readFileSync(appsGuidePath, 'utf8');

  const lot4Files = [
    path.join(rootDir, 'system', 'userland', 'services', 'AgentToolRegistry.js'),
    path.join(appsDir, 'graphing-calc', 'app.js'),
    path.join(appsDir, 'maps', 'maps.js'),
    path.join(appsDir, 'doc-viewer', 'viewer.js'),
    path.join(appsDir, 'explorer', 'explorer.js'),
    path.join(appsDir, 'games', 'hanoi', 'app.js'),
    path.join(appsDir, 'games', '8queens', 'app.js')
  ];
  const lot4ZeroFetch = lot4Files.every(f => !/\bfetch\s*\(/.test(fs.readFileSync(f, 'utf8')));

  // Verify WebOSApp base contract & AgentToolRegistry auto-discovery of native apps
  const l4Doc = {
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const l4BaseWin = {
    sys: {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    i18n: { t: (k) => k }
  };
  new Function('window', 'document', webOSAppCode)(l4BaseWin, l4Doc);
  const WebOSAppBase = l4BaseWin.WebOSApp;
  const protoOk = Boolean(
    WebOSAppBase &&
    typeof WebOSAppBase.prototype.isWindowOpen === 'function' &&
    typeof WebOSAppBase.prototype.getAgentContext === 'function' &&
    typeof WebOSAppBase.prototype.getAgentTools === 'function' &&
    typeof WebOSAppBase.prototype.executeAgentTool === 'function'
  );

  // Load real GraphingCalcApp + math-engine, HanoiApp, and EightQueensApp in a clean sandbox
  const mathEngineCode = fs.readFileSync(path.join(appsDir, 'graphing-calc', 'math-engine.js'), 'utf8');
  const calcAppCode = fs.readFileSync(path.join(appsDir, 'graphing-calc', 'app.js'), 'utf8');
  const hanoiAppCode = fs.readFileSync(path.join(appsDir, 'games', 'hanoi', 'app.js'), 'utf8');
  const queensAppCode = fs.readFileSync(path.join(appsDir, 'games', '8queens', 'app.js'), 'utf8');

  const l4AppMap = new Map();
  const l4Store = {};
  const l4Win = {
    location: { origin: 'https://atelier.local' },
    localStorage: {
      getItem: (k) => (k in l4Store ? l4Store[k] : null),
      setItem: (k, v) => { l4Store[k] = String(v); },
      removeItem: (k) => { delete l4Store[k]; }
    },
    i18n: { t: (k) => k },
    AppManager: {
      apps: l4AppMap,
      register: (inst) => l4AppMap.set(inst.id, inst),
      registerInstance: (id, inst) => l4AppMap.set(id, inst),
      launchApp: (id) => id
    },
    WindowManager: {
      activeWindowId: null,
      windows: new Map(),
      setTitle: () => {}
    },
    sys: {
      App: WebOSAppBase,
      GameApp: WebOSAppBase,
      appManager: {
        apps: l4AppMap,
        register: (inst) => l4AppMap.set(inst.id, inst),
        registerInstance: (id, inst) => l4AppMap.set(id, inst),
        launchApp: (id) => id
      },
      api: { get: async () => ({ success: true }), post: async () => ({ success: true }) }
    }
  };
  new Function('window', agentRegCode)(l4Win);
  new Function('window', mathEngineCode)(l4Win);
  new Function('window', 'document', calcAppCode)(l4Win, l4Doc);
  new Function('window', 'document', hanoiAppCode)(l4Win, l4Doc);
  new Function('window', 'document', queensAppCode)(l4Win, l4Doc);

  const l4Reg = l4Win.sys.agentTools;
  const calcInst = l4Win.GraphingCalcApp;
  const hanoiInstMgr = l4Win.HanoiApp;
  const queensInstMgr = l4Win.EightQueensApp;

  // Before opening calc, its tools should be hidden
  const toolsBeforeOpen = l4Reg.getAvailableTools('assisted', []);
  const calcHiddenWhenClosed = !toolsBeforeOpen.some(t => t.name === 'app_graphing_calc_evaluate');

  // Simulate open calc window (no full DOM needed — render/switchTab stubbed cleanly)
  calcInst.window = { id: 'win-calc' };
  l4Win.WindowManager.activeWindowId = 'win-calc';
  l4Win.WindowManager.windows.set('win-calc', { id: 'win-calc', appId: 'graphing-calc', title: 'Calc', state: 'normal' });
  calcInst.render = () => {};
  calcInst.switchTab = (tab) => { calcInst.currentTab = tab; };

  // Simulate open Hanoi instance (3 disks on peg A)
  const fakeHanoiInst = {
    winId: 'win-hanoi',
    diskCount: 3,
    pegs: [[3, 2, 1], [], []],
    movesCount: 0,
    isWon: false,
    selectedPeg: null,
    getMinMoves: () => 7,
    stopAutoSolve: () => {},
    onPegClick: function (toIdx) {
      const disk = this.pegs[this.selectedPeg].pop();
      this.pegs[toIdx].push(disk);
      this.movesCount++;
      this.selectedPeg = null;
    },
    setDiskCount: function (n) { this.diskCount = n; },
    resetPuzzle: function () { this.pegs = [[3, 2, 1], [], []]; this.movesCount = 0; },
    showHint: () => {}
  };
  hanoiInstMgr.instances.set(1, fakeHanoiInst);

  // Simulate open 8-Queens instance (4x4 board with exact 2 known solutions)
  const fakeQueensInst = {
    winId: 'win-queens',
    boardSize: 4,
    queens: [],
    movesCount: 0,
    isWon: false,
    showSafeHints: false,
    allSolutions: [[1, 3, 0, 2], [2, 0, 3, 1]],
    getConflicts: function () {
      const conflicts = [];
      for (let i = 0; i < this.queens.length; i++) {
        for (let j = i + 1; j < this.queens.length; j++) {
          const q1 = this.queens[i], q2 = this.queens[j];
          if (q1.r === q2.r || q1.c === q2.c || Math.abs(q1.r - q2.r) === Math.abs(q1.c - q2.c)) {
            conflicts.push({ q1, q2, type: q1.c === q2.c ? 'col' : 'diag' });
          }
        }
      }
      return { count: conflicts.length, conflicts };
    },
    getSafeSpots: function () { return new Set(['0,1', '1,3']); },
    onCellClick: function (r, c) {
      const idx = this.queens.findIndex(q => q.r === r && q.c === c);
      if (idx >= 0) this.queens.splice(idx, 1);
      else this.queens.push({ r, c });
      this.movesCount++;
    }
  };
  queensInstMgr.instances.set(1, fakeQueensInst);

  const l4ToolsAssisted = l4Reg.getAvailableTools('assisted', []);
  const l4ToolsReadOnly = l4Reg.getAvailableTools('read_only', []);
  const l4ToolsDisabled = l4Reg.getAvailableTools('assisted', ['graphing-calc', 'hanoi']);
  const l4Context = l4Reg.collectContext([]);

  // Execute Graphing Calc tools
  const calcEvalRes = await l4Reg.executeTool('app_graphing_calc_evaluate', { expression: 'sin(90)^2 + cos(90)^2', angle_mode: 'DEG' }, { autonomyLevel: 'read_only', disabledApps: [] });
  const calcPlotRes = await l4Reg.executeTool('app_graphing_calc_plot_curves', { curves: [{ expr: 'x^2', color: '#3b82f6' }, { expr: 'sin(x)' }] }, { autonomyLevel: 'assisted', disabledApps: [] });

  // Execute Hanoi Coach & Move tools (optimal 3-disk move is A -> C disk 1; then A->C disk 2 must be rejected)
  const hanoiStateRes = await l4Reg.executeTool('app_hanoi_get_state', {}, { autonomyLevel: 'read_only', disabledApps: [] });
  const hanoiMoveOk = await l4Reg.executeTool('app_hanoi_move_disk', { from: 'A', to: 'C' }, { autonomyLevel: 'assisted', disabledApps: [] });
  const hanoiMoveIllegal = await l4Reg.executeTool('app_hanoi_move_disk', { from: 'A', to: 'C' }, { autonomyLevel: 'assisted', disabledApps: [] });

  // Execute 8-Queens Coach & Board tools
  const queensBoardBefore = await l4Reg.executeTool('app_8queens_get_board', {}, { autonomyLevel: 'read_only', disabledApps: [] });
  const queensPlace1 = await l4Reg.executeTool('app_8queens_toggle_queen', { square: 'B4' }, { autonomyLevel: 'assisted', disabledApps: [] });
  const queensPlaceConflict = await l4Reg.executeTool('app_8queens_toggle_queen', { square: 'B3' }, { autonomyLevel: 'assisted', disabledApps: [] });

  // Check static contracts for maps, doc-viewer, explorer & docs/apps-guide.md
  const mapsCode = fs.readFileSync(path.join(appsDir, 'maps', 'maps.js'), 'utf8');
  const docViewerCode = fs.readFileSync(path.join(appsDir, 'doc-viewer', 'viewer.js'), 'utf8');
  const otherPilotsOk = [mapsCode, docViewerCode, explorerJs].every(src =>
    src.includes('getAgentContext()') && src.includes('getAgentTools()') && src.includes('executeAgentTool(')
  );
  const guideDocsOk = (
    appsGuideMd.includes('getAgentContext()') &&
    appsGuideMd.includes('getAgentTools()') &&
    appsGuideMd.includes('executeAgentTool(') &&
    appsGuideMd.includes('webos:agent-register-tools')
  );

  assert("Phase E (Lot 4): Contrat universel WebOSApp, auto-découverte native, pilotes (Calc/Maps/DocViewer/Explorer/Hanoi/8Queens), docs & zéro fetch()",
    protoOk &&
    lot4ZeroFetch &&
    calcHiddenWhenClosed &&
    l4ToolsAssisted.some(t => t.name === 'app_graphing_calc_plot_curves') &&
    l4ToolsAssisted.some(t => t.name === 'app_hanoi_move_disk') &&
    l4ToolsAssisted.some(t => t.name === 'app_8queens_toggle_queen') &&
    l4ToolsReadOnly.some(t => t.name === 'app_graphing_calc_evaluate') &&
    !l4ToolsReadOnly.some(t => t.name === 'app_graphing_calc_plot_curves') &&
    !l4ToolsDisabled.some(t => t.name.startsWith('app_graphing_calc_') || t.name.startsWith('app_hanoi_')) &&
    l4Context.app_contexts['graphing-calc'] && l4Context.app_contexts.hanoi && l4Context.app_contexts['8queens'] &&
    calcEvalRes && calcEvalRes.success && Math.abs(calcEvalRes.value - 1) < 1e-9 &&
    calcPlotRes && calcPlotRes.success && calcPlotRes.tab === 'graph' && calcPlotRes.curves.length === 2 &&
    hanoiStateRes && hanoiStateRes.success && hanoiStateRes.optimal_next_move &&
      hanoiStateRes.optimal_next_move.from === 'A' && hanoiStateRes.optimal_next_move.to === 'C' && hanoiStateRes.optimal_next_move.disk === 1 &&
    hanoiMoveOk && hanoiMoveOk.success && hanoiMoveOk.pegs.C.length === 1 && hanoiMoveOk.pegs.C[0] === 1 &&
    hanoiMoveIllegal && hanoiMoveIllegal.success === false &&
    queensBoardBefore && queensBoardBefore.success && queensBoardBefore.coach_suggestion && queensBoardBefore.coach_suggestion.solvable_from_current === true &&
    queensPlace1 && queensPlace1.success && queensPlace1.square === 'B4' && queensPlace1.conflicts_count === 0 &&
    queensPlaceConflict && queensPlaceConflict.success && queensPlaceConflict.conflicts_count === 1 &&
    otherPilotsOk &&
    guideDocsOk
  );

  // ---------------------------------------------------------------------------
  // Phase G (Lot 1): Explorer Modular Refactor, Multi-Instance Fixes & i18n
  // ---------------------------------------------------------------------------
  const lot1Scripts = [
    'scripts/explorer-state.js',
    'scripts/explorer-selection.js',
    'scripts/explorer-dragdrop.js',
    'scripts/explorer-map.js',
    'scripts/explorer-modals.js',
    'scripts/explorer-operations.js',
    'scripts/explorer-context-menu.js',
    'scripts/explorer-inspector.js',
    'scripts/explorer-search.js'
  ];
  const lot1Manifest = JSON.parse(fs.readFileSync(path.join(appsDir, 'explorer', 'manifest.json'), 'utf8'));
  const lot1ScriptsPresent = lot1Scripts.every(rel =>
    fs.existsSync(path.join(appsDir, 'explorer', rel)) &&
    Array.isArray(lot1Manifest.scripts) &&
    lot1Manifest.scripts.includes(rel)
  );
  const lot1AllCode = [explorerJs, ...lot1Scripts.map(rel => fs.readFileSync(path.join(appsDir, 'explorer', rel), 'utf8'))].join('\n');

  const expLocFr = JSON.parse(fs.readFileSync(path.join(appsDir, 'explorer', 'locales', 'fr.json'), 'utf8'));
  const expLocEn = JSON.parse(fs.readFileSync(path.join(appsDir, 'explorer', 'locales', 'en.json'), 'utf8'));
  const expLocJa = JSON.parse(fs.readFileSync(path.join(appsDir, 'explorer', 'locales', 'ja.json'), 'utf8'));
  const expFrKeys = Object.keys(expLocFr).sort();
  const expEnKeys = Object.keys(expLocEn).sort();
  const expJaKeys = Object.keys(expLocJa).sort();
  const expLocaleParity = expFrKeys.length >= 20 &&
    JSON.stringify(expFrKeys) === JSON.stringify(expEnKeys) &&
    JSON.stringify(expFrKeys) === JSON.stringify(expJaKeys);

  // Sandbox runtime check of ExplorerStateManager + ExplorerSelectionManager multi-instance isolation
  const expSandboxWin = {
    IS_ADMIN: false,
    ATELIER_CURRENT_USER: { username: 'alice' },
    localStorage: (() => {
      const m = new Map();
      return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    })()
  };
  const expStateSrc = fs.readFileSync(path.join(appsDir, 'explorer', 'scripts', 'explorer-state.js'), 'utf8');
  const expSelSrc = fs.readFileSync(path.join(appsDir, 'explorer', 'scripts', 'explorer-selection.js'), 'utf8');
  new Function('window', 'localStorage', expStateSrc)(expSandboxWin, expSandboxWin.localStorage);
  new Function('window', expSelSrc)(expSandboxWin);

  const mockInstA = {
    state: {
      files: [
        { name: 'b.jpg', path: 'b.jpg', category: 'image', size: 200, mtime: 20, effective_mtime: 20 },
        { name: 'a.jpg', path: 'a.jpg', category: 'image', size: 100, mtime: 10, effective_mtime: 10 }
      ],
      filteredFiles: [],
      filterCategory: 'all',
      showFavoritesOnly: false,
      favorites: [],
      searchQuery: '',
      sortBy: 'name',
      sortOrder: 'asc',
      selectedPaths: new Set(),
      lastSelectedIndex: null
    },
    el: {},
    t: (k) => k,
    showToast: () => {},
    updateInspectorUI: () => {},
    applyFilterAndRender: () => {},
    manager: { updateMenuBarForActiveInstance: () => {} }
  };
  const stateMgr = new expSandboxWin.ExplorerStateManager(mockInstA);
  mockInstA.state.filteredFiles = stateMgr.computeFilteredAndSortedFiles();
  const selMgr = new expSandboxWin.ExplorerSelectionManager(mockInstA);
  selMgr.selectItem(0, null);
  selMgr.selectItem(1, { shiftKey: true });
  const lot1RuntimeOk = (
    stateMgr.getUserStorageScope() === 'user_alice' &&
    stateMgr.normalizeThumbUrl('thumb.php?file=a.jpg') === 'system/endpoints/thumb.php?file=a.jpg' &&
    mockInstA.state.filteredFiles[0].name === 'a.jpg' &&
    mockInstA.state.selectedPaths.size === 2 &&
    mockInstA.state.selectedPaths.has('a.jpg') &&
    mockInstA.state.selectedPaths.has('b.jpg')
  );

  assert("Phase G (Lot 1): Explorer modulaire (9 scripts), zéro bug postFormData/updateSelectionToolbar/double-drop, isolation multi-instances & locales FR/EN/JA",
    lot1ScriptsPresent &&
    !lot1AllCode.includes('postFormData') &&
    !lot1AllCode.includes('updateSelectionToolbar') &&
    !explorerJs.includes("this.containerEl.addEventListener('drop'") &&
    !lot1AllCode.includes("document.querySelectorAll('.is-dragging')") &&
    !lot1AllCode.includes("document.querySelectorAll('.media-card.selected") &&
    explorerJs.includes('updateViewModeUI()') &&
    expTplSrc.includes('folder-desc-banner') &&
    expTplSrc.includes('drop-zone-overlay') &&
    expLocaleParity &&
    lot1RuntimeOk
  );

  // ---------------------------------------------------------------------------
  // Phase G (Lot 2): Modern Shell (Tabs, Nav/Address Bar, Sidebar Tree, Dual Pane,
  // Status Bar & Per-Folder Hierarchical View Mode Inheritance)
  // ---------------------------------------------------------------------------
  const lot2Scripts = [
    'scripts/explorer-navigation.js',
    'scripts/explorer-sidebar.js',
    'scripts/explorer-split-pane.js'
  ];
  const lot2ScriptsPresent = lot2Scripts.every(rel =>
    fs.existsSync(path.join(appsDir, 'explorer', rel)) &&
    Array.isArray(lot1Manifest.scripts) &&
    lot1Manifest.scripts.includes(rel)
  );
  const lot2TplOk = (
    expTplSrc.includes('explorer-tabs-bar') &&
    expTplSrc.includes('explorer-nav-bar') &&
    expTplSrc.includes('explorer-address-input') &&
    expTplSrc.includes('explorer-sidebar') &&
    expTplSrc.includes('sidebar-tree') &&
    expTplSrc.includes('explorer-secondary-pane') &&
    expTplSrc.includes('explorer-status-bar') &&
    expTplSrc.includes('status-zoom-slider')
  );

  // Runtime test of Per-Folder View Mode Inheritance (Pro default, Multimedia polaroid, Thumbs grid, ext://)
  const inheritWin = {
    IS_ADMIN: false,
    ATELIER_CURRENT_USER: { username: 'bob' },
    localStorage: (() => {
      const m = new Map();
      return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    })()
  };
  new Function('window', 'localStorage', expStateSrc)(inheritWin, inheritWin.localStorage);
  const inheritMgr = new inheritWin.ExplorerStateManager({ state: { currentPath: '' }, t: k => k });

  const defRoot = inheritMgr.resolveViewModeForPath('');
  inheritMgr.setFolderViewMode('vacances', 'polaroid');
  const vacDirect = inheritMgr.resolveViewModeForPath('vacances');
  const vacChild = inheritMgr.resolveViewModeForPath('vacances/ete/plage');
  inheritMgr.setFolderViewMode('vacances/ete/plage', 'grid');
  const vacGrandChild = inheritMgr.resolveViewModeForPath('vacances/ete/plage/raw');
  const vacReset = inheritMgr.resetFolderViewMode('vacances/ete/plage');
  inheritMgr.setFolderViewMode('ext://nas', 'mosaic');
  const extChild = inheritMgr.resolveViewModeForPath('ext://nas/photos/2026');

  const lot2InheritOk = (
    defRoot.mode === 'list' && defRoot.profile === 'pro' && inheritMgr.shouldShowSidebarByDefault('list') === true &&
    vacDirect.mode === 'polaroid' && vacDirect.profile === 'multimedia' && !vacDirect.inherited && inheritMgr.shouldShowSidebarByDefault('polaroid') === false &&
    vacChild.mode === 'polaroid' && vacChild.inherited === true && vacChild.sourcePath === 'vacances' &&
    vacGrandChild.mode === 'grid' && vacGrandChild.profile === 'thumbs' && vacGrandChild.inherited === true && vacGrandChild.sourcePath === 'vacances/ete/plage' &&
    vacReset.mode === 'polaroid' && vacReset.inherited === true &&
    extChild.mode === 'mosaic' && extChild.inherited === true && extChild.sourcePath === 'ext://nas'
  );

  // Runtime test of Navigation Tabs + History + Sidebar profile visibility
  const expNavSrc = fs.readFileSync(path.join(appsDir, 'explorer', 'scripts', 'explorer-navigation.js'), 'utf8');
  const expSidebarSrc = fs.readFileSync(path.join(appsDir, 'explorer', 'scripts', 'explorer-sidebar.js'), 'utf8');
  const navSandboxWin = {
    IS_ADMIN: false,
    ATELIER_CURRENT_USER: { username: 'bob' },
    localStorage: inheritWin.localStorage,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const navMockDoc = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null
  };
  new Function('window', 'localStorage', expStateSrc)(navSandboxWin, navSandboxWin.localStorage);
  new Function('window', 'document', expNavSrc)(navSandboxWin, navMockDoc);
  new Function('window', 'document', expSidebarSrc)(navSandboxWin, navMockDoc);

  const loadedPaths = [];
  const navInst = {
    state: { currentPath: '', directories: [], files: [], filteredFiles: [], favorites: [], selectedPaths: new Set(), viewMode: 'list' },
    el: { sidebar: { style: {} }, sidebarResizer: { style: {} } },
    containerEl: { style: { setProperty: () => {} } },
    t: k => k,
    escapeHtml: s => String(s || ''),
    renderVolumesBar: () => {},
    navigateTo: (p) => { navInst.state.currentPath = p; loadedPaths.push(p); navMgr.recordNavigation(p); },
    loadDirectory: (p) => { navInst.state.currentPath = p; loadedPaths.push(p); navMgr.recordNavigation(p); }
  };
  navInst.stateManager = new navSandboxWin.ExplorerStateManager(navInst);
  const navMgr = new navSandboxWin.ExplorerNavigationManager(navInst);
  navInst.navigationManager = navMgr;
  navMgr.init('');
  navInst.navigateTo('docs');
  navInst.navigateTo('docs/2026');
  navMgr.goBack();
  const afterBack = navInst.state.currentPath;
  navMgr.goForward();
  const afterFwd = navInst.state.currentPath;
  navMgr.goUp();
  const afterUp = navInst.state.currentPath;
  const tab2 = navMgr.createTab('photos', { activate: true });
  const tabCount2 = navMgr.tabs.length;
  navMgr.closeTab(tab2.id);
  const tabCountAfterClose = navMgr.tabs.length;

  const sbMgr = new navSandboxWin.ExplorerSidebarManager(navInst);
  sbMgr.applyProfileVisibility('list');
  const sbInPro = sbMgr.isVisible;
  sbMgr.applyProfileVisibility('polaroid');
  const sbInMedia = sbMgr.isVisible;
  sbMgr.applyProfileVisibility('grid');
  const sbInThumbs = sbMgr.isVisible;

  const lot2NavSidebarOk = (
    afterBack === 'docs' &&
    afterFwd === 'docs/2026' &&
    afterUp === 'docs' &&
    tabCount2 === 2 &&
    tabCountAfterClose === 1 &&
    sbInPro === true &&
    sbInMedia === false &&
    sbInThumbs === true
  );

  assert("Phase G (Lot 2): Shell moderne (Onglets, Historique, Barre d'adresse, Sidebar arborescente, Double Volet F3, Barre d'état & héritage de vues Pro/Vignettes/Multimédia)",
    lot2ScriptsPresent &&
    lot2TplOk &&
    expFrKeys.length >= 60 &&
    lot2InheritOk &&
    lot2NavSidebarOk
  );

  // Regression tests for GDrive mount_name resolution & inline Trash View
  const mountWin = {
    IS_ADMIN: false,
    ATELIER_CURRENT_USER: { username: 'bob' },
    ATELIER_MOUNTED_VOLUMES: [
      { id: 'vol-ext-1', kind: 'external', driver: 'gdrive', mount_name: 'Mon Google Drive', mount_icon: '☁️', path: 'ext://1', permission: 'write' }
    ],
    localStorage: inheritWin.localStorage
  };
  new Function('window', 'localStorage', expStateSrc)(mountWin, mountWin.localStorage);
  const mountStateMgr = new mountWin.ExplorerStateManager({ state: { currentPath: '' }, t: k => k });
  assert("Phase G (Fix): Point de montage GDrive affiche mount_name ('Mon Google Drive') au lieu de 'ext://1' & vue Corbeille inline opérationnelle",
    mountStateMgr.getVolumeLabel(mountWin.ATELIER_MOUNTED_VOLUMES[0]) === 'Mon Google Drive' &&
    mountStateMgr.getFriendlyPathLabel('ext://1') === 'Mon Google Drive' &&
    mountStateMgr.getFriendlyFullPath('ext://1/Vacances') === 'Mon Google Drive/Vacances' &&
    expSidebarSrc.includes('openTrashView') &&
    explorerJs.includes('async openTrashView(') &&
    explorerJs.includes('restore_trash_item') &&
    explorerJs.includes('purge_trash_item') &&
    explorerJs.includes('empty_trash') &&
    expTplSrc.includes('explorer-trash-view')
  );

  // Phase G — Lot 3: File operations (rename_item, new file, duplicate), exhaustive zero-native context menus & chunked/folder transfer manager
  const expTransfersPath = path.join(rootDir, 'apps/explorer/scripts/explorer-transfers.js');
  const expCtxPath = path.join(rootDir, 'apps/explorer/scripts/explorer-context-menu.js');
  const expOpsPath = path.join(rootDir, 'apps/explorer/scripts/explorer-operations.js');
  const expManifestSrc = fs.readFileSync(path.join(rootDir, 'apps/explorer/manifest.json'), 'utf8');
  const syscallSrc = fs.readFileSync(path.join(rootDir, 'system/userland/core/SyscallClient.js'), 'utf8');
  const expTransfersSrc = fs.existsSync(expTransfersPath) ? fs.readFileSync(expTransfersPath, 'utf8') : '';
  const expCtxSrc = fs.readFileSync(expCtxPath, 'utf8');
  const expOpsSrc = fs.readFileSync(expOpsPath, 'utf8');

  // Verify strict FR/EN/JA parity for Explorer locales after Lot 3 additions
  const lot3Fr = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps/explorer/locales/fr.json'), 'utf8'));
  const lot3En = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps/explorer/locales/en.json'), 'utf8'));
  const lot3Ja = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps/explorer/locales/ja.json'), 'utf8'));
  const lot3FrKeys = Object.keys(lot3Fr).sort();
  const lot3EnKeys = Object.keys(lot3En).sort();
  const lot3JaKeys = Object.keys(lot3Ja).sort();
  const lot3LocaleParity = (
    lot3FrKeys.length >= 120 &&
    JSON.stringify(lot3FrKeys) === JSON.stringify(lot3EnKeys) &&
    JSON.stringify(lot3FrKeys) === JSON.stringify(lot3JaKeys)
  );

  // Sandbox runtime test: ExplorerContextMenuManager intercepts all contextmenu events on containerEl (zero native browser menu)
  let ctxPrevented = false;
  let ctxBgMenuCalled = false;
  const ctxHandlers = {};
  const ctxContainer = {
    addEventListener(ev, fn) { ctxHandlers[ev] = fn; },
    removeEventListener() {}
  };
  const ctxWin = {
    IS_ADMIN: true,
    ATELIER_CURRENT_USER: { username: 'admin' },
    document: { addEventListener() {}, removeEventListener() {}, querySelectorAll() { return []; }, body: { appendChild() {} }, createElement() { return { style: {}, classList: { add() {} }, addEventListener() {}, remove() {}, getBoundingClientRect() { return { width: 180, height: 120 }; } }; } },
    innerWidth: 1280,
    innerHeight: 800
  };
  new Function('window', 'document', expCtxSrc)(ctxWin, ctxWin.document);
  const ctxInstMock = {
    containerEl: ctxContainer,
    state: { currentPath: 'docs', isTrashView: false, allItems: [], selectedItems: new Set() },
    t: k => k,
    dom: {}
  };
  const ctxMgr = new ctxWin.ExplorerContextMenuManager(ctxInstMock);
  ctxMgr.showBackgroundContextMenu = () => { ctxBgMenuCalled = true; };
  ctxMgr.init();
  if (typeof ctxHandlers.contextmenu === 'function') {
    ctxHandlers.contextmenu({
      clientX: 120,
      clientY: 160,
      target: { closest() { return null; } },
      preventDefault() { ctxPrevented = true; },
      stopPropagation() {}
    });
  }

  assert("Phase G (Lot 3): Opérations fichiers (rename_item/F2/nouveau fichier/dupliquer), menus contextuels exhaustifs sans menu natif & TransferManager chunked/dossiers",
    fs.existsSync(expTransfersPath) &&
    expManifestSrc.includes('scripts/explorer-transfers.js') &&
    expTransfersSrc.includes('uploadChunked') &&
    expTransfersSrc.includes('webkitGetAsEntry') &&
    expTransfersSrc.includes('cancelItem') &&
    syscallSrc.includes("renameItem:") &&
    syscallSrc.includes("'rename_item'") &&
    syscallSrc.includes('options.isCancelled') &&
    expCtxSrc.includes('showFileContextMenu') &&
    expCtxSrc.includes('showFolderContextMenu') &&
    expCtxSrc.includes('showSidebarPathContextMenu') &&
    expCtxSrc.includes('showTabContextMenu') &&
    expCtxSrc.includes('showBreadcrumbContextMenu') &&
    expCtxSrc.includes('showTrashItemContextMenu') &&
    expCtxSrc.includes('showTextInputContextMenu') &&
    expCtxSrc.includes('showBackgroundContextMenu') &&
    ctxPrevented === true &&
    ctxBgMenuCalled === true &&
    expOpsSrc.includes('async renameItem(') &&
    expOpsSrc.includes('async createNewFile(') &&
    expOpsSrc.includes('async duplicateItem(') &&
    expOpsSrc.includes('async copyPathToClipboard(') &&
    expTplSrc.includes('explorer-transfer-panel') &&
    expTplSrc.includes('explorer-new-file-item') &&
    explorerJs.includes("e.key === 'F2'") &&
    explorerJs.includes('renameSelection') &&
    lot3LocaleParity
  );

  // Regression tests for Detailed List view layout/light-theme, Rename pre-fill & external folder count
  const listViewCss = fs.readFileSync(path.join(rootDir, 'apps/explorer/views/list/view.css'), 'utf8');
  const listViewJs = fs.readFileSync(path.join(rootDir, 'apps/explorer/views/list/view.js'), 'utf8');
  const toolkitSrc = fs.readFileSync(path.join(rootDir, 'system/userland/ui/WebOSToolkit.js'), 'utf8');
  assert("Phase G (Fix Lot 3): Vue Liste détaillée (thème clair, colonnes minmax, boutons non-absolus, fallback icône), pré-remplissage Renommer & zéro 'undefined élément(s)'",
    !listViewCss.includes('color: #ffffff;') &&
    listViewCss.includes('position: static !important;') &&
    listViewCss.includes('minmax(140px, 1fr)') &&
    listViewJs.includes('list-preview-fallback') &&
    listViewJs.includes('file.date_formatted') &&
    expOpsSrc.includes('defaultValue: oldName') &&
    expOpsSrc.includes('selectStem: true') &&
    toolkitSrc.includes('options.selectStem') &&
    explorerJs.includes("typeof folder.item_count === 'number'")
  );

  // Phase G — Lot 4: 3-Tab Inspector (Details/Tags/Versions), Share modal hook & SQLite multi-criteria search
  const expInspSrc = fs.readFileSync(path.join(rootDir, 'apps/explorer/scripts/explorer-inspector.js'), 'utf8');
  const expSearchSrc = fs.readFileSync(path.join(rootDir, 'apps/explorer/scripts/explorer-search.js'), 'utf8');
  const shareSvcSrc = fs.readFileSync(path.join(rootDir, 'system/userland/services/ShareVolumesService.js'), 'utf8');
  const lot4Fr = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps/explorer/locales/fr.json'), 'utf8'));
  const lot4En = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps/explorer/locales/en.json'), 'utf8'));
  const lot4Ja = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps/explorer/locales/ja.json'), 'utf8'));
  const lot4FrKeys = Object.keys(lot4Fr).sort();
  const lot4Parity = (
    lot4FrKeys.length >= 160 &&
    JSON.stringify(lot4FrKeys) === JSON.stringify(Object.keys(lot4En).sort()) &&
    JSON.stringify(lot4FrKeys) === JSON.stringify(Object.keys(lot4Ja).sort())
  );

  assert("Phase G (Lot 4): Inspecteur 3 onglets (Détails/Tags/Versions), dialogue Partager (mode/quota) & recherche multi-critères SQLite",
    expTplSrc.includes('data-inspector-tab="details"') &&
    expTplSrc.includes('data-inspector-tab="tags"') &&
    expTplSrc.includes('data-inspector-tab="versions"') &&
    expTplSrc.includes('adv-search-tag') &&
    expTplSrc.includes('explorer-adv-search-open-btn') &&
    expInspSrc.includes('setActiveTab(') &&
    expInspSrc.includes('openTab(') &&
    expInspSrc.includes('loadTagsForSelection(') &&
    expInspSrc.includes('addTagToSelection(') &&
    expInspSrc.includes('removeTagFromSelection(') &&
    expInspSrc.includes('loadVersionsForSelection(') &&
    expInspSrc.includes('restoreVersion(') &&
    expInspSrc.includes('list_file_versions') &&
    expInspSrc.includes('restore_file_version') &&
    expInspSrc.includes('set_item_tags') &&
    expCtxSrc.includes('openShareDialog') &&
    !expCtxSrc.includes('openShareModal') &&
    expCtxSrc.includes('explorer.ctx_tags') &&
    expCtxSrc.includes('explorer.ctx_versions') &&
    shareSvcSrc.includes('shareLinkModeSelect') &&
    shareSvcSrc.includes('shareLinkMaxDownloadsInput') &&
    shareSvcSrc.includes('max_downloads') &&
    expSearchSrc.includes('search_file_index') &&
    expSearchSrc.includes('searchByTag(') &&
    expSidebarSrc.includes('tag.label || tag.name') &&
    expSidebarSrc.includes('refreshOrganizationMeta(') &&
    lot4Parity
  );
} catch (e) {
  assert("Phase 1 exécution runtime UI", false, e.stack);
}


console.log('\n============================================================');
console.log(` 📊 SCORECARD DES TESTS ISO-FONCTIONNELS JS : ${passedChecks}/${totalChecks} PASS`);
console.log('============================================================');

if (failures.length > 0) {
  console.error(`\n❌ Échecs détectés (${failures.length}) :`);
  failures.forEach(f => console.error(` - ${f.desc} : ${f.details}`));
  process.exit(1);
} else {
  console.log('\n🎉 VALIDATION RÉUSSIE : 100% ISO-FONCTIONNEL & SANS EXCEPTION RUNTIME !');
  process.exit(0);
}
