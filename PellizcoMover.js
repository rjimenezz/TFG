AFRAME.registerComponent('pinch-move', {
  schema: {
    hand:   { type: 'string', default: 'any' },  // 'left' | 'right' | 'any'
    radius: { type: 'number', default: 0.15 },   // metros para considerar que el pellizco está "sobre" el objeto
    debug:  { type: 'boolean', default: false }
  },

  init: function () {
    this.sceneEl = this.el.sceneEl;
    this.renderer = this.sceneEl && this.sceneEl.renderer || null;
    this.referenceSpace = null;

    this.grabbing   = false;
    this.grabHand   = null;
    this.grabOffset = new THREE.Vector3();   // offset entre objeto y punto de pellizco
    this.tmpWorldPos = new THREE.Vector3();
    this.tmpPinchPos = new THREE.Vector3();
    this.tmpTarget   = new THREE.Vector3();

    if (this.data.debug) {
      this._debugSphere = document.createElement('a-sphere');
      this._debugSphere.setAttribute('radius', this.data.radius);
      this._debugSphere.setAttribute('color', '#8844ff');
      this._debugSphere.setAttribute('opacity', 0.15);
      this._debugSphere.setAttribute('segments-width', 12);
      this._debugSphere.setAttribute('segments-height', 8);
      this.el.appendChild(this._debugSphere);
    }

    this.detector = document.getElementById('detector');
    if (!this.detector) {
      console.warn('[pinch-move] No se encontró #detector en el DOM. Añade <a-entity id="detector" gesto-pellizco> en la escena.');
      return;
    }

    this._onPinchStart = this._onPinchStart.bind(this);
    this._onPinchMove  = this._onPinchMove.bind(this);
    this._onPinchEnd   = this._onPinchEnd.bind(this);

    this.detector.addEventListener('pinchstart', this._onPinchStart);
    this.detector.addEventListener('pinchmove',  this._onPinchMove);
    this.detector.addEventListener('pinchend',   this._onPinchEnd);
  },

  remove: function () {
    if (this.detector) {
      this.detector.removeEventListener('pinchstart', this._onPinchStart);
      this.detector.removeEventListener('pinchmove',  this._onPinchMove);
      this.detector.removeEventListener('pinchend',   this._onPinchEnd);
    }
    if (this._debugSphere) this._debugSphere.remove();
  },

  _matchHand: function (hand) {
    return this.data.hand === 'any' || this.data.hand === hand;
  },

  // Punto medio entre pulgar e índice en coordenadas de mundo
  _getPinchWorldPosition: function (handedness) {
    const sceneEl = this.sceneEl;
    const renderer = sceneEl && sceneEl.renderer;
    if (!renderer) return null;

    const session = renderer.xr.getSession();
    const frame   = sceneEl.frame;
    if (!session || !frame) return null;

    if (!this.referenceSpace) {
      this.referenceSpace = renderer.xr.getReferenceSpace();
      if (!this.referenceSpace) return null;
    }

    for (const inputSource of session.inputSources) {
      if (!inputSource.hand) continue;
      if (inputSource.handedness !== handedness) continue;

      const thumbJoint = inputSource.hand.get('thumb-tip');
      const indexJoint = inputSource.hand.get('index-finger-tip');
      if (!thumbJoint || !indexJoint) continue;

      const thumbPose = frame.getJointPose(thumbJoint, this.referenceSpace);
      const indexPose = frame.getJointPose(indexJoint, this.referenceSpace);
      if (!thumbPose || !indexPose) continue;

      const tx = thumbPose.transform.position.x;
      const ty = thumbPose.transform.position.y;
      const tz = thumbPose.transform.position.z;
      const ix = indexPose.transform.position.x;
      const iy = indexPose.transform.position.y;
      const iz = indexPose.transform.position.z;

      this.tmpPinchPos.set(
        (tx + ix) / 2,
        (ty + iy) / 2,
        (tz + iz) / 2
      );
      return this.tmpPinchPos;
    }

    return null;
  },

  _onPinchStart: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand) return;
    if (!this._matchHand(hand)) return;

    const pinchPos = this._getPinchWorldPosition(hand);
    if (!pinchPos) return;

    // Distancia del pellizco al centro del objeto
    this.el.object3D.getWorldPosition(this.tmpWorldPos);
    const dist = this.tmpWorldPos.distanceTo(pinchPos);
    if (dist > this.data.radius) return; // demasiado lejos del objeto

    this.grabbing = true;
    this.grabHand = hand;

    // Offset entre el centro del objeto y el pellizco (en mundo)
    this.grabOffset.copy(this.tmpWorldPos).sub(pinchPos);

    this.el.emit('pinchmoverstart', { hand, distance: dist }, false);
  },

  _onPinchMove: function (e) {
    if (!this.grabbing) return;
    const hand = e.detail && e.detail.hand;
    if (hand !== this.grabHand) return;

    const pinchPos = this._getPinchWorldPosition(hand);
    if (!pinchPos) return;

    // Nueva posición en mundo
    this.tmpTarget.copy(pinchPos).add(this.grabOffset);

    // Convertir a coordenadas locales del padre (más robusto)
    const parent = this.el.object3D.parent;
    if (parent) {
      parent.worldToLocal(this.tmpTarget);
    }
    this.el.object3D.position.copy(this.tmpTarget);

    this.el.emit('pinchmovermove', { hand, position: this.tmpTarget.clone() }, false);
  },

  _onPinchEnd: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!this.grabbing || hand !== this.grabHand) return;

    this.grabbing = false;
    this.el.emit('pinchmoverend', { hand }, false);
    this.grabHand = null;
  }
});