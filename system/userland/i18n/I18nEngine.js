/**
 * Atelier Userland - i18n Internationalization Engine
 */
class I18nEngine {
    constructor() {
        this.currentLocale = 'fr';
        this.translations = {};
        this.availableLocales = {};
        this.hydrateFromBootstrap();
    }

    /**
     * Synchronously hydrates translations from the server-injected bootstrap payload
     * (`window.ATELIER_I18N_CONFIG` or `<script id="initialLocalesConfig">`) so early boot
     * services, modals, and toasts NEVER see an empty dictionary before `desktop.js` runs.
     */
    hydrateFromBootstrap() {
        let cfg = (typeof window !== 'undefined' && window.ATELIER_I18N_CONFIG) ? window.ATELIER_I18N_CONFIG : null;
        if (!cfg && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
            const el = document.getElementById('initialLocalesConfig');
            if (el && el.textContent) {
                try {
                    cfg = JSON.parse(el.textContent);
                } catch (e) {}
            }
        }
        if (cfg && typeof cfg === 'object') {
            if (cfg.default) {
                this.currentLocale = String(cfg.default);
            }
            if (cfg.locales && typeof cfg.locales === 'object') {
                this.availableLocales = cfg.locales;
            }
            if (cfg.translations && typeof cfg.translations === 'object' && Object.keys(cfg.translations).length > 0) {
                this.translations = cfg.translations;
            }
        }
    }

    async init(defaultLocale = 'fr') {
        this.currentLocale = localStorage.getItem('atelier_locale') || defaultLocale;
        await this.loadTranslations(this.currentLocale);
    }

    async loadTranslations(code) {
        try {
            const data = (window.sys && window.sys.api)
                ? await window.sys.api.get('get_locale', { code })
                : await (await fetch(`system/endpoints/api.php?action=get_locale&code=${encodeURIComponent(code)}`)).json();
            if (data && data.success && data.translations) {
                this.translations = data.translations;
                this.currentLocale = code;
                localStorage.setItem('atelier_locale', code);
                window.sys.events.emit('locale:changed', { code, translations: this.translations });
            }
        } catch (err) {
            console.error(`[I18nEngine] Failed to load locale ${code}:`, err);
        }
    }

    t(key, replacements = {}) {
        if (!this.translations || Object.keys(this.translations).length === 0) {
            this.hydrateFromBootstrap();
        }
        let text = (this.translations && this.translations[key]) || key;
        for (const [k, v] of Object.entries(replacements)) {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
        return text;
    }

    translate(key, replacements = {}) {
        return this.t(key, replacements);
    }

    setTranslations(code, translations) {
        this.currentLocale = code;
        this.translations = translations || {};
    }

    getAvailableLocales() {
        if (window.desktop && window.desktop.state && window.desktop.state.availableLocales && Object.keys(window.desktop.state.availableLocales).length > 0) {
            return window.desktop.state.availableLocales;
        }
        if (this.availableLocales && Object.keys(this.availableLocales).length > 0) {
            return this.availableLocales;
        }
        return {
            fr: { code: 'fr', name: 'Français', flag: '🇫🇷' },
            en: { code: 'en', name: 'English', flag: '🇬🇧' },
            ja: { code: 'ja', name: '日本語', flag: '🇯🇵' }
        };
    }

    translateDOM(scope = document) {
        if (!scope || typeof scope.querySelectorAll !== 'function') return;

        scope.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const replacements = {};
            if (el.dataset.i18nCount !== undefined) {
                replacements.count = el.dataset.i18nCount;
            }
            if (el.dataset.i18nParams) {
                try {
                    Object.assign(replacements, JSON.parse(el.dataset.i18nParams));
                } catch (e) {}
            }
            const trans = this.t(key, replacements);
            if (trans && trans !== key) {
                if (trans.includes('<') && trans.includes('>')) {
                    el.innerHTML = trans;
                } else {
                    el.textContent = trans;
                }
            }
        });

        scope.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.dataset.i18nTitle;
            const trans = this.t(key);
            if (trans && trans !== key) el.setAttribute('title', trans);
        });

        scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            const trans = this.t(key);
            if (trans && trans !== key) el.setAttribute('placeholder', trans);
        });
    }

    setAvailableLocales(locales) {
        if (locales && typeof locales === 'object') {
            this.availableLocales = locales;
        }
    }
}

window.sys = window.sys || {};
window.sys.i18n = new I18nEngine();
window.I18nEngine = window.sys.i18n;

