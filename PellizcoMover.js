/**
 * Componente: pinch-move
 * Permite mover objetos con pellizco usando colisionadores OBB.
 * Solo traslación (sin rotación).
 */
AFRAME.registerComponent('pinch-move', {
  schema: {
    hand: { type: 'string', default: 'any' },
    // Tamaño del colisionador OBB del objeto (metros)
    colliderSize: { type: 'vec3', default: {x: 0.3, y: 0.3, z: 0.3} },
    debug: { type: 'boolean', default: false }
  },

  init: function () {
    this.sceneEl = this.el.sceneEl;
    this.detector = document.getElementById('detector');
    
    if (!this.detector || !this.detector.components['gesto-pellizco']) {
      console.warn('[pinch-move] Falta #detector con gesto-pellizco.');
      return;
    }

    this.grabbing = false;
    this.grabHand = null;

    // Offset de agarre (en mundo)
    this.grabOffset = new THREE.Vector3();
    this.tmpWorldPos = new THREE.Vector3();
    this.tmpTarget = new THREE.Vector3();

    // OBB del objeto
    this.obb = {
      center: new THREE.Vector3(),
      size: new THREE.Vector3(
        this.data.colliderSize.x,
        this.data.colliderSize.y,
        this.data.colliderSize.z
      ),
      quaternion: new THREE.Quaternion(),
      box3: new THREE.Box3()
    };

    // Debug visual
    if (this.data.debug) {
      this._debugBox = document.createElement('a-box');
      this._debugBox.setAttribute('width', this.data.colliderSize.x);
      this._debugBox.setAttribute('height', this.data.colliderSize.y);
      this._debugBox.setAttribute('depth', this.data.colliderSize.z);
      this._debugBox.setAttribute('color', '#ff0');
      this._debugBox.setAttribute('opacity', 0.2);
      this._debugBox.setAttribute('wireframe', true);
      this.el.appendChild(this._debugBox);
    }

    this._onPinchStart = this._onPinchStart.bind(this);
    this._onPinchMove = this._onPinchMove.bind(this);
    this._onPinchEnd = this._onPinchEnd.bind(this);

    this.detector.addEventListener('pinchstart', this._onPinchStart);
    this.detector.addEventListener('pinchmove', this._onPinchMove);
    this.detector.addEventListener('pinchend', this._onPinchEnd);
  },

  remove: function () {
    if (this.detector) {
      this.detector.removeEventListener('pinchstart', this._onPinchStart);
      this.detector.removeEventListener('pinchmove', this._onPinchMove);
      this.detector.removeEventListener('pinchend', this._onPinchEnd);
    }
    if (this._debugBox) this._debugBox.remove();
  },

  tick: function () {
    // Actualizar OBB del objeto
    this.el.object3D.getWorldPosition(this.obb.center);
    this.el.object3D.getWorldQuaternion(this.obb.quaternion);
    this.obb.box3.setFromCenterAndSize(this.obb.center, this.obb.size);

    // Debug visual
    if (this._debugBox) {
      this._debugBox.object3D.position.set(0, 0, 0);
      this._debugBox.object3D.quaternion.set(0, 0, 0, 1);
    }
  },

  _matchHand: function (hand) {
    return this.data.hand === 'any' || this.data.hand === hand;
  },

  // Test de colisión OBB-OBB simplificado (usando AABB como aproximación)
  _testOBBCollision: function (obb1, obb2) {
    return obb1.box3.intersectsBox(obb2.box3);
  },

  _onPinchStart: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand || !this._matchHand(hand)) return;

    const handOBB = e.detail.obb;
    if (!handOBB) return;

    // Test de colisión
    if (!this._testOBBCollision(handOBB, this.obb)) return;

    // Iniciar agarre
    this.grabbing = true;
    this.grabHand = hand;

    // Guardar offset: posición objeto - centro mano
    this.el.object3D.getWorldPosition(this.tmpWorldPos);
    this.grabOffset.copy(this.tmpWorldPos).sub(handOBB.center);

    this.el.emit('pinchmoverstart', { hand }, false);
    
    // Cambiar color para feedback visual
    this.el.setAttribute('color', '#ff4444');
  },

  _onPinchMove: function (e) {
    if (!this.grabbing) return;
    const hand = e.detail && e.detail.hand;
    if (hand !== this.grabHand) return;

    const handOBB = e.detail.obb;
    if (!handOBB) return;

    // Nueva posición = centro mano + offset
    this.tmpTarget.copy(handOBB.center).add(this.grabOffset);

    // Convertir a coordenadas locales del padre
    const parent = this.el.object3D.parent;
    if (parent) parent.worldToLocal(this.tmpTarget);
    
    this.el.object3D.position.copy(this.tmpTarget);
  },

  _onPinchEnd: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!this.grabbing || hand !== this.grabHand) return;

    this.grabbing = false;
    this.grabHand = null;
    
    this.el.emit('pinchmoverend', { hand }, false);
    
    // Restaurar color
    this.el.setAttribute('color', '#4CAF50');
  }
});