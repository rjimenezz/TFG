/**
 * Componente: pinch-move
 * Permite mover objetos con pellizco SOLO si hay contacto entre colisionadores OBB.
 * Usa SAT (Separating Axis Theorem) para colisión OBB real.
 * Solo traslación (sin rotación).
 */
AFRAME.registerComponent('pinch-move', {
  schema: {
    hand: { type: 'string', default: 'any' },
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

    this.isPinching = { left: false, right: false };
    this.inContact = { left: false, right: false };
    
    this.grabbing = false;
    this.grabHand = null;

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
      halfSize: new THREE.Vector3(
        this.data.colliderSize.x / 2,
        this.data.colliderSize.y / 2,
        this.data.colliderSize.z / 2
      ),
      quaternion: new THREE.Quaternion(),
      matrix: new THREE.Matrix4()
    };

    // Debug visual
    if (this.data.debug) {
      this._debugBox = document.createElement('a-box');
      this._debugBox.setAttribute('width', this.data.colliderSize.x);
      this._debugBox.setAttribute('height', this.data.colliderSize.y);
      this._debugBox.setAttribute('depth', this.data.colliderSize.z);
      this._debugBox.setAttribute('color', '#0f0');
      this._debugBox.setAttribute('opacity', 0.25);
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
    this.obb.matrix.compose(this.obb.center, this.obb.quaternion, new THREE.Vector3(1,1,1));

    // Comprobar contacto con cada mano usando SAT
    const gestoComp = this.detector.components['gesto-pellizco'];
    if (gestoComp) {
      ['left', 'right'].forEach(h => {
        const handOBB = gestoComp.getHandOBB(h);
        if (handOBB) {
          const wasInContact = this.inContact[h];
          this.inContact[h] = this._testOBBCollisionSAT(handOBB, this.obb);
          
          // LOG: solo cambios de contacto
          if (this.inContact[h] && !wasInContact) {
            console.log(`[CONTACTO] 🟢 Mano ${h} TOCANDO objeto ${this.el.id || 'sin-id'}`);
            this.el.emit('hand-contact-start', { hand: h }, false);
          } else if (!this.inContact[h] && wasInContact) {
            console.log(`[CONTACTO] 🔴 Mano ${h} DEJÓ DE TOCAR objeto ${this.el.id || 'sin-id'}`);
            this.el.emit('hand-contact-end', { hand: h }, false);
          }
        } else {
          this.inContact[h] = false;
        }
      });
    }

    // Si está agarrado pero ya no hay contacto O no hay pellizco -> soltar
    if (this.grabbing) {
      if (!this.inContact[this.grabHand] || !this.isPinching[this.grabHand]) {
        this._releaseGrab();
      }
    }

    // Debug visual
    if (this._debugBox) {
      this._debugBox.object3D.position.set(0, 0, 0);
      this._debugBox.object3D.quaternion.set(0, 0, 0, 1);
      
      if (this.grabbing) {
        this._debugBox.setAttribute('color', '#f00');
      } else if (this.inContact.left || this.inContact.right) {
        this._debugBox.setAttribute('color', '#ff0');
      } else {
        this._debugBox.setAttribute('color', '#0f0');
      }
    }
  },

  _matchHand: function (hand) {
    return this.data.hand === 'any' || this.data.hand === hand;
  },

  // Test de colisión OBB-OBB usando Separating Axis Theorem (SAT)
  _testOBBCollisionSAT: function (obb1, obb2) {
    // Extraer ejes de cada OBB
    const axes1 = this._getOBBAxes(obb1.quaternion);
    const axes2 = this._getOBBAxes(obb2.quaternion);
    
    // Vector entre centros
    const T = new THREE.Vector3().subVectors(obb2.center, obb1.center);
    
    // Testear los 15 ejes potenciales de separación:
    // 3 ejes de obb1, 3 ejes de obb2, 9 productos cruz
    const testAxes = [
      ...axes1,
      ...axes2,
      ...this._getCrossAxes(axes1, axes2)
    ];
    
    for (const axis of testAxes) {
      if (axis.lengthSq() < 1e-6) continue; // Skip ejes degenerados
      
      const L = axis.clone().normalize();
      
      // Proyectar radios de ambos OBBs sobre el eje
      const r1 = this._projectOBBRadius(obb1, axes1, L);
      const r2 = this._projectOBBRadius(obb2, axes2, L);
      
      // Proyectar distancia entre centros
      const distance = Math.abs(T.dot(L));
      
      // Si hay separación en este eje -> no colisionan
      if (distance > r1 + r2) {
        return false;
      }
    }
    
    // No se encontró eje de separación -> colisionan
    return true;
  },

  _getOBBAxes: function (quaternion) {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    return [
      new THREE.Vector3(m.elements[0], m.elements[1], m.elements[2]),  // X
      new THREE.Vector3(m.elements[4], m.elements[5], m.elements[6]),  // Y
      new THREE.Vector3(m.elements[8], m.elements[9], m.elements[10])  // Z
    ];
  },

  _getCrossAxes: function (axes1, axes2) {
    const crosses = [];
    for (const a1 of axes1) {
      for (const a2 of axes2) {
        crosses.push(new THREE.Vector3().crossVectors(a1, a2));
      }
    }
    return crosses;
  },

  _projectOBBRadius: function (obb, axes, L) {
    return Math.abs(obb.halfSize.x * axes[0].dot(L)) +
           Math.abs(obb.halfSize.y * axes[1].dot(L)) +
           Math.abs(obb.halfSize.z * axes[2].dot(L));
  },

  _onPinchStart: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand || !this._matchHand(hand)) return;

    this.isPinching[hand] = true;

    // Solo agarrar si hay contacto previo
    if (!this.grabbing && this.inContact[hand]) {
      this._startGrab(hand, e.detail.obb);
    }
  },

  _onPinchMove: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand || !this._matchHand(hand)) return;

    // Intentar agarrar si se cumplen condiciones
    if (!this.grabbing && this.isPinching[hand] && this.inContact[hand]) {
      this._startGrab(hand, e.detail.obb);
    }

    // Actualizar posición si está agarrado
    if (this.grabbing && hand === this.grabHand) {
      const handOBB = e.detail.obb;
      if (!handOBB) return;

      this.tmpTarget.copy(handOBB.center).add(this.grabOffset);
      const parent = this.el.object3D.parent;
      if (parent) parent.worldToLocal(this.tmpTarget);
      this.el.object3D.position.copy(this.tmpTarget);
    }
  },

  _onPinchEnd: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand) return;

    this.isPinching[hand] = false;

    if (this.grabbing && hand === this.grabHand) {
      this._releaseGrab();
    }
  },

  _startGrab: function (hand, handOBB) {
    if (!handOBB) return;

    this.grabbing = true;
    this.grabHand = hand;

    this.el.object3D.getWorldPosition(this.tmpWorldPos);
    this.grabOffset.copy(this.tmpWorldPos).sub(handOBB.center);

    console.log(`[AGARRE] 🎯 AGARRADO objeto ${this.el.id || 'sin-id'} con mano ${hand}`);
    this.el.emit('pinchmoverstart', { hand }, false);
    this.el.setAttribute('color', '#ff4444');
  },

  _releaseGrab: function () {
    if (!this.grabbing) return;

    const hand = this.grabHand;
    this.grabbing = false;
    this.grabHand = null;
    
    console.log(`[AGARRE] 🔓 SOLTADO objeto ${this.el.id || 'sin-id'} (mano ${hand})`);
    this.el.emit('pinchmoverend', { hand }, false);
    this.el.setAttribute('color', '#4CAF50');
  }
});