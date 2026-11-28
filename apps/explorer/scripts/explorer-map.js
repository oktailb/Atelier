/**
 * Atelier by GallusTech - Explorer Map & Smart GPS Manager (apps/explorer/scripts/explorer-map.js)
 * Coordinates smart GPS timeline deduction, folder map badge updates, standalone Maps handoff,
 * and embedded Leaflet modal fallback.
 */
(function (window) {
  'use strict';

  class ExplorerMapManager {
    constructor(instance) {
      this.inst = instance;
    }

    computeSmartGpsLocations(files, isSmartGpsEnabled = true) {
      if (!files || files.length === 0) return [];
      if (window.sys && typeof window.sys.computeSmartGpsLocations === 'function') {
        return window.sys.computeSmartGpsLocations(files, isSmartGpsEnabled);
      }

      const result = [];
      files.forEach(f => {
        if (f.exif && f.exif.gps && typeof f.exif.gps.lat === 'number' && typeof f.exif.gps.lng === 'number') {
          result.push({
            file: f,
            lat: f.exif.gps.lat,
            lng: f.exif.gps.lng,
            gps_source: 'native',
            time: (f.effective_mtime || f.mtime) * 1000
          });
        }
      });
      return result;
    }

    updateFolderMapButton() {
      const mapped = this.computeSmartGpsLocations(this.inst.state.filteredFiles, this.inst.isSmartGpsEnabled);
      const count = mapped.length;

      if (this.inst.el.folderMapBtn) {
        if (count === 0) {
          this.inst.el.folderMapBtn.style.display = 'none';
        } else {
          this.inst.el.folderMapBtn.innerHTML = `🗺️ ${this.inst.escapeHtml(this.inst.t('nav.map'))} (${count})`;
          this.inst.el.folderMapBtn.style.display = 'inline-flex';
        }
      }

      const menuMapBtn = document.getElementById('menuFolderMapBtn');
      if (menuMapBtn && this.inst.manager.getActiveInstance() === this.inst) {
        menuMapBtn.style.display = count > 0 ? 'inline-flex' : 'none';
      }
    }

    openMapModal(focusPath = null) {
      if (window.sys && typeof window.sys.openMaps === 'function') {
        window.sys.openMaps({
          files: this.inst.state.filteredFiles,
          currentPath: this.inst.state.currentPath,
          focusPath: focusPath,
          singleItem: !!focusPath
        });
        return;
      }
      if (!this.inst.el.mapModal) return;
      this.inst.el.mapModal.style.display = 'flex';
      this.initLeafletMap(focusPath);
    }

    closeMapModal() {
      if (this.inst.el.mapModal) {
        this.inst.el.mapModal.style.display = 'none';
      }
    }

    initLeafletMap(focusPath = null) {
      if (!window.L || !this.inst.el.galleryLeafletMap) return;

      const locations = this.computeSmartGpsLocations(this.inst.state.filteredFiles, this.inst.isSmartGpsEnabled);
      if (this.inst.el.mapModalCountBadge) {
        this.inst.el.mapModalCountBadge.textContent = this.inst.t('explorer.map_geotagged_count', { count: locations.length });
      }

      if (!this.inst.leafletMap) {
        this.inst.leafletMap = window.L.map(this.inst.el.galleryLeafletMap, { zoomControl: true });
        this.inst.leafletTileLayer = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap'
        }).addTo(this.inst.leafletMap);
        this.inst.leafletMarkersLayer = (window.L.markerClusterGroup
          ? window.L.markerClusterGroup()
          : window.L.layerGroup()
        ).addTo(this.inst.leafletMap);
      } else {
        this.inst.leafletMarkersLayer.clearLayers();
      }

      if (locations.length === 0) return;

      const bounds = [];
      let focusMarker = null;

      locations.forEach(item => {
        const marker = window.L.marker([item.lat, item.lng]);
        const gpsLabel = item.gps_source === 'native'
          ? `📍 ${this.inst.escapeHtml(this.inst.t('explorer.map_gps_native'))}`
          : `✨ ${this.inst.escapeHtml(this.inst.t('explorer.map_gps_deduced'))}`;

        marker.bindPopup(`
          <div style="text-align:center;font-size:0.85rem;">
            <img src="${this.inst.escapeHtml(item.file.thumb_url)}" style="width:120px;height:80px;object-fit:cover;border-radius:4px;margin-bottom:4px;" alt="" />
            <div style="font-weight:600;">${this.inst.escapeHtml(item.file.name)}</div>
            <div style="font-size:0.75rem;opacity:0.75;">${gpsLabel}</div>
          </div>
        `);
        this.inst.leafletMarkersLayer.addLayer(marker);
        bounds.push([item.lat, item.lng]);
        if (focusPath && item.file.path === focusPath) {
          focusMarker = marker;
        }
      });

      if (focusMarker) {
        this.inst.leafletMap.setView(focusMarker.getLatLng(), 15);
        focusMarker.openPopup();
      } else if (bounds.length > 0) {
        this.inst.leafletMap.fitBounds(bounds, { padding: [40, 40] });
      }

      setTimeout(() => {
        if (this.inst.leafletMap) this.inst.leafletMap.invalidateSize();
      }, 250);
    }

    destroy() {
      if (this.inst.leafletMap) {
        try { this.inst.leafletMap.remove(); } catch (e) { }
        this.inst.leafletMap = null;
        this.inst.leafletMarkersLayer = null;
        this.inst.leafletRouteLayer = null;
        this.inst.leafletTileLayer = null;
      }
    }
  }

  window.ExplorerMapManager = ExplorerMapManager;
})(window);
