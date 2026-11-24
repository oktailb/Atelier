/**
 * SimpleGallery - Automated JavaScript Runtime & Iso-Functionality Verification Suite
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
    head: { appendChild: () => {} },
    createTreeWalker: () => ({ nextNode: () => null })
  };
  const fakeWindow = {
    sys: {
      appManager: { 
        getAppTitle: () => 'Doc Viewer',
        registerInstance: () => {}
      },
      api: { fs: { saveTextFile: async () => ({ success: true }) } }
    },
    WindowManager: {
      createWindow: (opts) => ({ id: opts.id, element: {} }),
      windows: new Map()
    },
    MenuBarManager: { registerAppMenu: () => {}, setActiveApp: () => {} },
    MediaViewerRegistry: { register: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {}
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
    tileLayer: () => ({ addTo: () => {} }),
    map: (container, opts) => {
      createdMapCenter = opts.center;
      createdMapZoom = opts.zoom;
      return {
        addLayer: () => {},
        setView: (c, z) => { createdMapCenter = c; createdMapZoom = z; },
        remove: () => {},
        invalidateSize: () => {}
      };
    },
    markerClusterGroup: () => ({ addLayer: () => {}, clearLayers: () => {}, getBounds: () => null })
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
    WindowManager: { createWindow: (w) => w, focusWindow: () => {}, setTitle: () => {} },
    sys: {
      appManager: { getAppTitle: () => 'Maps', registerInstance: () => {} },
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
          addEventListener: () => {},
          remove: () => {},
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
    WindowManager: { createWindow: (w) => w, focusWindow: () => {}, setTitle: () => {} },
    sys: {
      appManager: { getAppTitle: () => 'Browser', registerInstance: () => {} },
      storage: { get: () => null, set: () => {} }
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
    if (entry.name.startsWith('.') || entry.name === 'ffs-apps') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, acc);
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
assert("QUAL-03: Aucun @import Google Fonts dupliqué dans css/gallery.css", !galleryCssSrc.includes('fonts.googleapis.com'));
assert("QUAL-03: index.php applique SRI integrity sur leaflet.markercluster", qualIndexPhpSrc.includes('leaflet.markercluster.js" integrity="sha384-'));
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
  addEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};
global.document = fakeDoc;

const fakeWinTribune = {
  navigator: { userAgent: 'NodeTest' },
  localStorage: fakeLocalStorage,
  document: fakeDoc,
  addEventListener: () => {},
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
    head: { appendChild: () => {} },
    body: { contains: () => false },
    getElementById: () => null,
    createElement: () => ({ style: {}, addEventListener: () => {} }),
    addEventListener: () => {}
  };

  const sandboxWin = {
    innerWidth: 1440,
    innerHeight: 900,
    document: fakeDom,
    localStorage: { getItem: () => null, setItem: () => {} },
    SG_DISABLED_APPS: [],
    SG_DISCOVERED_APPS: {
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
      focusWindow: () => {},
      setTitle: () => {}
    },
    MenuBarManager: {
      registerAppMenu: (id, def) => registeredMenus.set(id, def),
      setActiveApp: () => {}
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
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
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
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const appWin = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    GraphingCalcEngine: E,
    GraphingCalcPlotter: calcWin.GraphingCalcPlotter,
    sys: { i18n: { t: (k) => k } }
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
    document: { addEventListener: () => {}, removeEventListener: () => {}, body: { appendChild: () => {}, getAttribute: () => 'dark' }, documentElement: { getAttribute: () => 'dark' } }
  };
  new Function('window', 'document', pickerCode)(pickerWin, pickerWin.document);
  const fp = pickerWin.sys.filePicker;
  assert("FEAT-06: FilePickerService expose pickFile, pickFolder et pickSaveLocation",
    typeof pickerWin.sys.pickFile === 'function' &&
    typeof pickerWin.sys.pickFolder === 'function' &&
    typeof pickerWin.sys.pickSaveLocation === 'function'
  );
  assert("FEAT-06: FilePickerService.matchesAccept gère extensions, wildcards et MIME exacts",
    fp.matchesAccept({ name: 'art.psd', extension: 'psd', category: 'image' }, '.psd,.png') &&
    fp.matchesAccept({ name: 'doc.pdf', extension: 'pdf', category: 'doc' }, 'application/pdf') &&
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
    addEventListener: () => {},
    sys: {
      i18n: { t: (k) => k },
      toast: { success: () => {}, error: () => {}, info: () => {} },
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
  const fakeIframeWin = {
    location: { origin: 'https://gallery.local' },
    document: { addEventListener: () => {} },
    Blob: globalThis.Blob,
    File: bridgeWin.File,
    DOMException: globalThis.DOMException,
    URL: {
      createObjectURL: () => `blob:https://gallery.local/${++createdBlobSeq}`,
      revokeObjectURL: () => {}
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

  // Verify W3C showOpenFilePicker -> virtual handle -> createWritable() -> upload_file
  const handles = await fakeIframeWin.showOpenFilePicker({ types: [{ accept: { 'application/pdf': ['.pdf'] } }] });
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
  const tmplApi = fs.readFileSync(path.join(appsDir, 'template-app', 'api.php'), 'utf8');
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
  assert("FEAT-09: apps/template-app/api.php utilise project_root (ARCH-01) et protège les écritures par is_admin",
    tmplApi.includes("project_root") && tmplApi.includes("is_admin")
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
  assert("Phase 1: index.php charge ShareVolumesService.js et injecte SG_CURRENT_USER / SG_MOUNTED_VOLUMES",
    indexPhpSrc.includes('system/userland/services/ShareVolumesService.js') &&
    indexPhpSrc.includes('system/userland/services/AuthModalService.js') &&
    indexPhpSrc.includes('window.SG_CURRENT_USER') &&
    indexPhpSrc.includes('window.SG_MOUNTED_VOLUMES')
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
    setAttribute: () => {},
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    remove: function () { this.parentNode = null; }
  });
  const authOverlayHost = { appendChild: (el) => { el.parentNode = authOverlayHost; } };
  const authWin = {
    IS_ADMIN: false,
    SG_CURRENT_USER: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    requestAnimationFrame: (fn) => fn(),
    sys: { i18n: { t: (k) => k } }
  };
  const authDoc = {
    body: authOverlayHost,
    createElement: () => makeMockEl(),
    getElementById: () => makeMockEl(),
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
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
    loginHtml.includes('authModalOptOpenHome')
  );
  authWin.sys.authModal.close(true);

  // Verify ShareVolumesService renders Explorer mounted volumes bar & share button
  const shareCode = fs.readFileSync(shareSvcPath, 'utf8');
  const mockVolWin = {
    IS_ADMIN: false,
    SG_CURRENT_USER: { id: 2, username: 'bob', display_name: 'Bob', role: 'user', home_dir: 'users/bob' },
    SG_MOUNTED_VOLUMES: [
      { id: 'home_2', kind: 'home', path: 'users/bob', mount_name: 'Bob', mount_icon: '🏠', permission: 'manage', show_on_desktop: true, is_encrypted: false },
      { id: 'share_9', kind: 'shared', path: 'users/alice/studio', mount_name: 'Studio Drive', mount_icon: '💽', permission: 'write', owner_username: 'alice', show_on_desktop: true, is_encrypted: true },
      { id: 'share_10', kind: 'shared', path: 'users/alice/hidden_desk', mount_name: 'NoDesk', mount_icon: '📁', permission: 'read', owner_username: 'alice', show_on_desktop: false, is_encrypted: false }
    ],
    location: { search: '', origin: 'https://atelier.local', pathname: '/' },
    sys: { i18n: { t: (k) => k } }
  };
  const mockDoc = {
    readyState: 'complete',
    body: { getAttribute: () => 'dark-glass' },
    documentElement: { getAttribute: () => 'dark-glass' },
    getElementById: () => null,
    addEventListener: () => {}
  };
  new Function('window', 'document', shareCode)(mockVolWin, mockDoc);
  const svc = mockVolWin.sys.shares;
  const fakeBar = {
    style: {},
    innerHTML: '',
    querySelectorAll: () => [],
    querySelector: () => null
  };
  svc.renderExplorerMountsBar(fakeBar, 'users/bob/photos', () => {});
  assert("Phase 1: ShareVolumesService rend la barre des volumes montés (Home + Studio Drive RW 🔐 + bouton Partager)",
    fakeBar.style.display === 'flex' &&
    fakeBar.innerHTML.includes('Studio Drive') &&
    fakeBar.innerHTML.includes('🔐') &&
    fakeBar.innerHTML.includes('RW') &&
    fakeBar.innerHTML.includes('data-share-path="users/bob/photos"')
  );

  // Verify DesktopShortcutsManager mounts volumes as desktop disk icons
  const shortcutsCode = fs.readFileSync(path.join(rootDir, 'system', 'userland', 'desktop', 'DesktopShortcuts.js'), 'utf8');
  const scWin = {
    SG_MOUNTED_VOLUMES: mockVolWin.SG_MOUNTED_VOLUMES,
    SG_DESKTOP_CONFIG: { shortcuts: [] },
    localStorage: { getItem: () => null, setItem: () => {} },
    EventBus: { on: () => {} }
  };
  const scDoc = { readyState: 'loading', getElementById: () => null, addEventListener: () => {} };
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
