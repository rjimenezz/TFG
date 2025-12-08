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

    this.colliderType = this.detector.components['gesto-pellizco'].data.colliderType;
    console.log(`[pinch-move] Usando colisionador: ${this.colliderType}`);

    this.isPinching = { left: false, right: false };
    this.inContact = { left: false, right: false };
    
    this.grabbing = false;
    this.grabHand = null;
    
    // NUEVO: Guardar padre original y offset local
    this.originalParent = null;
    this.localOffset = new THREE.Vector3();
    this.localRotation = new THREE.Quaternion();

    this.tmpWorldPos = new THREE.Vector3();

    // Crear colisionador del objeto
    if (this.colliderType === 'obb-collider') {
      this.el.setAttribute('obb-collider', `size: ${this.data.colliderSize.x} ${this.data.colliderSize.y} ${this.data.colliderSize.z}`);
      
      if (this.data.debug) {
        const debugBox = document.createElement('a-box');
        debugBox.setAttribute('width', this.data.colliderSize.x);
        debugBox.setAttribute('height', this.data.colliderSize.y);
        debugBox.setAttribute('depth', this.data.colliderSize.z);
        debugBox.setAttribute('color', '#00f');
        debugBox.setAttribute('opacity', 0.25);
        debugBox.setAttribute('wireframe', true);
        this.el.appendChild(debugBox);
        this.debugBox = debugBox;
      }
      
      this.el.addEventListener('obbcollisionstarted', this._onOBBCollisionStart.bind(this));
      this.el.addEventListener('obbcollisionended', this._onOBBCollisionEnd.bind(this));
    } else {
      const colliderConfig = `size: ${this.data.colliderSize.x} ${this.data.colliderSize.y} ${this.data.colliderSize.z}; debug: ${this.data.debug}`;
      this.el.setAttribute('sat-collider', colliderConfig);
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
    this.el.removeAttribute(this.colliderType);
    if (this.debugBox) this.debugBox.remove();
  },

  _onOBBCollisionStart: function(e) {
    const collidedWith = e.detail.withEl;
    if (collidedWith.id.startsWith('hand-collider-')) {
      const hand = collidedWith.id.includes('left') ? 'left' : 'right';
      this.inContact[hand] = true;
      console.log(`[CONTACTO-OBB-COLLIDER] 🟢 Mano ${hand} TOCANDO objeto ${this.el.id || 'sin-id'}`);
    }
  },

  _onOBBCollisionEnd: function(e) {
    const collidedWith = e.detail.withEl;
    if (collidedWith.id.startsWith('hand-collider-')) {
      const hand = collidedWith.id.includes('left') ? 'left' : 'right';
      this.inContact[hand] = false;
      console.log(`[CONTACTO-OBB-COLLIDER] 🔴 Mano ${hand} DEJÓ DE TOCAR objeto ${this.el.id || 'sin-id'}`);
    }
  },

  tick: function () {
    const gestoComp = this.detector.components['gesto-pellizco'];
    if (!gestoComp) return;

    // Solo hacer detección manual si es sat-collider
    if (this.colliderType === 'sat-collider') {
      const objectCollider = this.el.components['sat-collider'];
      if (!objectCollider) return;

      ['left', 'right'].forEach(h => {
        const handCollider = gestoComp.getHandCollider(h);
        
        if (handCollider) {
          const wasInContact = this.inContact[h];
          const handOBB = handCollider.getOBB();
          const objectOBB = objectCollider.getOBB();
          this.inContact[h] = handCollider.testCollision(objectOBB);
          
          if (this.inContact[h] && !wasInContact) {
            console.log(`[CONTACTO-SAT-COLLIDER] 🟢 Mano ${h} TOCANDO objeto ${this.el.id || 'sin-id'}`);
            this.el.emit('hand-contact-start', { hand: h }, false);
          } else if (!this.inContact[h] && wasInContact) {
            console.log(`[CONTACTO-SAT-COLLIDER] 🔴 Mano ${h} DEJÓ DE TOCAR objeto ${this.el.id || 'sin-id'}`);
            this.el.emit('hand-contact-end', { hand: h }, false);
          }
        } else {
          this.inContact[h] = false;
        }
      });
    }

    if (this.grabbing) {
      if (!this.inContact[this.grabHand] || !this.isPinching[this.grabHand]) {
        this._releaseGrab();
      }
    }

    // Debug visual
    if (this.data.debug) {
      const debugEl = this.colliderType === 'obb-collider' ? this.debugBox : this.el.components['sat-collider']?._debugBox;
      if (debugEl) {
        const color = this.grabbing ? '#f00' : (this.inContact.left || this.inContact.right) ? '#ff0' : (this.colliderType === 'sat-collider' ? '#0f0' : '#00f');
        debugEl.setAttribute('color', color);
      }
    }
  },

  _matchHand: function (hand) {
    return this.data.hand === 'any' || this.data.hand === hand;
  },

  _onPinchStart: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand || !this._matchHand(hand)) return;

    this.isPinching[hand] = true;

    if (!this.grabbing && this.inContact[hand]) {
      this._startGrab(hand);
    }
  },

  _onPinchMove: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand || !this._matchHand(hand)) return;

    if (!this.grabbing && this.isPinching[hand] && this.inContact[hand]) {
      this._startGrab(hand);
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

  _startGrab: function (hand) {
    const gestoComp = this.detector.components['gesto-pellizco'];
    const handCollider = gestoComp.getHandCollider(hand);
    if (!handCollider) return;

    this.grabbing = true;
    this.grabHand = hand;

    // Obtener el collider entity de la mano
    const handColliderEl = gestoComp.state[hand].colliderEntity;
    if (!handColliderEl) return;

    // CLAVE: Guardar padre original
    this.originalParent = this.el.object3D.parent;

    // Calcular posición/rotación mundial del objeto ANTES de reparenting
    const objWorldPos = new THREE.Vector3();
    const objWorldQuat = new THREE.Quaternion();
    const objWorldScale = new THREE.Vector3();
    
    this.el.object3D.getWorldPosition(objWorldPos);
    this.el.object3D.getWorldQuaternion(objWorldQuat);
    this.el.object3D.getWorldScale(objWorldScale);

    // PARENTING: Hacer que el objeto sea hijo del collider de la mano
    handColliderEl.object3D.add(this.el.object3D);

    // Ahora convertir la posición/rotación mundial a coordenadas locales del nuevo padre
    const handInverseMatrix = new THREE.Matrix4();
    handInverseMatrix.copy(handColliderEl.object3D.matrixWorld).invert();
    
    // Aplicar la transformación inversa a la posición mundial
    this.el.object3D.position.copy(objWorldPos).applyMatrix4(handInverseMatrix);
    
    // Calcular rotación local relativa a la mano
    const handWorldQuat = new THREE.Quaternion();
    handColliderEl.object3D.getWorldQuaternion(handWorldQuat);
    const handInverseQuat = handWorldQuat.clone().invert();
    this.el.object3D.quaternion.copy(handInverseQuat).multiply(objWorldQuat);
    
    // Mantener escala original
    this.el.object3D.scale.copy(objWorldScale);

    console.log(`[AGARRE] 🎯 AGARRADO objeto ${this.el.id || 'sin-id'} con mano ${hand}`);
    console.log(`  Pos local: ${this.el.object3D.position.x.toFixed(3)}, ${this.el.object3D.position.y.toFixed(3)}, ${this.el.object3D.position.z.toFixed(3)}`);
    this.el.emit('pinchmoverstart', { hand }, false);
    this.el.setAttribute('color', '#ff4444');
  },

  _releaseGrab: function () {
    if (!this.grabbing) return;

    const hand = this.grabHand;
    const gestoComp = this.detector.components['gesto-pellizco'];
    const handColliderEl = gestoComp.state[hand]?.colliderEntity;

    // Guardar transformación mundial ANTES de cambiar de padre
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    
    this.el.object3D.getWorldPosition(worldPos);
    this.el.object3D.getWorldQuaternion(worldQuat);
    this.el.object3D.getWorldScale(worldScale);

    console.log(`[AGARRE] 🔓 SOLTANDO objeto ${this.el.id || 'sin-id'}`);
    console.log(`  Pos mundial antes: ${worldPos.x.toFixed(3)}, ${worldPos.y.toFixed(3)}, ${worldPos.z.toFixed(3)}`);

    // UNPARENTING: Devolver al padre original
    if (this.originalParent) {
      this.originalParent.add(this.el.object3D);
    } else {
      this.sceneEl.object3D.add(this.el.object3D);
    }

    // Convertir transformación mundial a coordenadas locales del nuevo padre
    const parentInverseMatrix = new THREE.Matrix4();
    const targetParent = this.originalParent || this.sceneEl.object3D;
    parentInverseMatrix.copy(targetParent.matrixWorld).invert();
    
    // Aplicar transformación inversa
    const localPos = worldPos.clone().applyMatrix4(parentInverseMatrix);
    this.el.object3D.position.copy(localPos);
    
    // Para la rotación, calcular relativa al nuevo padre
    const parentWorldQuat = new THREE.Quaternion();
    targetParent.getWorldQuaternion(parentWorldQuat);
    const parentInverseQuat = parentWorldQuat.clone().invert();
    this.el.object3D.quaternion.copy(parentInverseQuat).multiply(worldQuat);
    
    // Restaurar escala
    this.el.object3D.scale.copy(worldScale);

    console.log(`  Pos local después: ${this.el.object3D.position.x.toFixed(3)}, ${this.el.object3D.position.y.toFixed(3)}, ${this.el.object3D.position.z.toFixed(3)}`);

    this.grabbing = false;
    this.grabHand = null;
    
    this.el.emit('pinchmoverend', { hand }, false);
    this.el.setAttribute('color', '#4CAF50');
  }
});