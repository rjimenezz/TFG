/**
 * Componente: grabbable
 * Hace que un objeto pueda ser agarrado con pellizco.
 * Compatible con super-hands: solo añadir 'grabbable' al objeto.
 */
AFRAME.registerComponent('grabbable', {
  schema: {
    maxGrabbers: { type: 'int', default: NaN }, // ← CAMBIO: NaN = ilimitado (como super-hands)
    invert: { type: 'boolean', default: false },
    suppressY: { type: 'boolean', default: false },
    colliderSize: { type: 'vec3', default: {x: 0.3, y: 0.3, z: 0.3} },
    debug: { type: 'boolean', default: false }
  },

  init: function () {
    this.sceneEl = this.el.sceneEl;
    
    // Esperar a que el detector esté listo
    if (this.sceneEl.hasLoaded) {
      this._setup();
    } else {
      this.sceneEl.addEventListener('loaded', () => this._setup());
    }
  },

  _setup: function () {
    this.detector = document.getElementById('detector');
    
    if (!this.detector || !this.detector.components['gesto-pellizco']) {
      console.warn('[grabbable] Falta #detector con gesto-pellizco. Creando detector automático...');
      this._createDetector();
    }

    // Obtener tipo de colisionador del detector
    const gestoComp = this.detector.components['gesto-pellizco'];
    this.colliderType = gestoComp ? gestoComp.data.colliderType : 'sat-collider';

    this.grabbers = [];
    this.originalY = null;
    this.inContact = { left: false, right: false };
    this.isPinching = { left: false, right: false };

    // AUTO-AÑADIR colisionador si no existe
    this._ensureCollider();

    // Escuchar eventos de pellizco
    this._onPinchStart = this._onPinchStart.bind(this);
    this._onPinchEnd = this._onPinchEnd.bind(this);

    this.detector.addEventListener('pinchstart', this._onPinchStart);
    this.detector.addEventListener('pinchend', this._onPinchEnd);

    const maxGrabbersText = isNaN(this.data.maxGrabbers) ? 'ilimitado' : this.data.maxGrabbers;
    console.log(`[grabbable] ✅ Inicializado en ${this.el.id || this.el.tagName} (${this.colliderType}, maxGrabbers: ${maxGrabbersText})`);
  },

  /**
   * Crear detector automáticamente si no existe (como super-hands)
   */
  _createDetector: function () {
    console.log('[grabbable] Creando detector automático...');
    
    const detector = document.createElement('a-entity');
    detector.setAttribute('id', 'detector');
    detector.setAttribute('gesto-pellizco', {
      hand: 'any',
      startDistance: 0.025,
      endDistance: 0.035,
      emitEachFrame: true,
      debugCollider: false,
      colliderType: 'sat-collider'
    });
    
    this.sceneEl.appendChild(detector);
    this.detector = detector;
    
    // Añadir manos visuales (opcional)
    const manos = document.createElement('a-entity');
    manos.setAttribute('manos-esferas', {
      useJointRadius: true,
      colorLeft: '#39f',
      colorRight: '#f93',
      opacity: 0.7,
      labels: false
    });
    this.sceneEl.appendChild(manos);
  },

  remove: function () {
    if (this.detector) {
      this.detector.removeEventListener('pinchstart', this._onPinchStart);
      this.detector.removeEventListener('pinchend', this._onPinchEnd);
    }
    
    while (this.grabbers.length > 0) {
      this._releaseGrab(this.grabbers[0].hand);
    }
  },

  _ensureCollider: function () {
    const hasCollider = this.el.components['sat-collider'] || this.el.components['obb-collider'];
    
    if (!hasCollider) {
      // Calcular tamaño del colisionador basado en la geometría del objeto
      let size = this.data.colliderSize;
      
      const geometry = this.el.getAttribute('geometry');
      if (geometry) {
        // Adaptar tamaño según la geometría existente
        if (geometry.primitive === 'box') {
          size = {
            x: geometry.width || 1,
            y: geometry.height || 1,
            z: geometry.depth || 1
          };
        } else if (geometry.primitive === 'sphere') {
          const r = (geometry.radius || 0.5) * 2;
          size = { x: r, y: r, z: r };
        }
      }
      
      console.log(`[grabbable] Añadiendo ${this.colliderType} con tamaño:`, size);
      
      const colliderConfig = `size: ${size.x} ${size.y} ${size.z}; debug: ${this.data.debug}`;
      this.el.setAttribute(this.colliderType, colliderConfig);
    }
  },

  _onOBBCollisionStart: function(e) {
    const collidedWith = e.detail.withEl;
    if (collidedWith && collidedWith.id && collidedWith.id.startsWith('hand-collider-')) {
      const hand = collidedWith.id.includes('left') ? 'left' : 'right';
      this.inContact[hand] = true;
      console.log(`[grabbable] 🟢 Contacto con mano ${hand}`);
    }
  },

  _onOBBCollisionEnd: function(e) {
    const collidedWith = e.detail.withEl;
    if (collidedWith && collidedWith.id && collidedWith.id.startsWith('hand-collider-')) {
      const hand = collidedWith.id.includes('left') ? 'left' : 'right';
      this.inContact[hand] = false;
      console.log(`[grabbable] 🔴 Perdió contacto con mano ${hand}`);
    }
  },

  tick: function () {
    if (!this.detector) return;
    
    const gestoComp = this.detector.components['gesto-pellizco'];
    if (!gestoComp) return;

    // Detección de colisión manual para sat-collider
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
            console.log(`[grabbable] 🟢 Contacto con mano ${h}`);
          } else if (!this.inContact[h] && wasInContact) {
            console.log(`[grabbable] 🔴 Perdió contacto con mano ${h}`);
          }
        } else {
          this.inContact[h] = false;
        }
      });
    }

    // Verificar agarres activos
    for (let i = this.grabbers.length - 1; i >= 0; i--) {
      const grabber = this.grabbers[i];
      if (!this.inContact[grabber.hand] || !this.isPinching[grabber.hand]) {
        this._releaseGrab(grabber.hand);
      }
    }

    // Aplicar suppressY
    if (this.data.suppressY && this.originalY !== null && this.grabbers.length > 0) {
      this.el.object3D.position.y = this.originalY;
    }
  },

  _onPinchStart: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand) return;

    this.isPinching[hand] = true;

    // ← CAMBIO: Solo verificar límite si maxGrabbers NO es NaN
    const hasLimit = !isNaN(this.data.maxGrabbers);
    const belowLimit = !hasLimit || this.grabbers.length < this.data.maxGrabbers;

    if (this.inContact[hand] && belowLimit) {
      this._startGrab(hand);
    }
  },

  _onPinchEnd: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand) return;

    this.isPinching[hand] = false;

    const grabberIndex = this.grabbers.findIndex(g => g.hand === hand);
    if (grabberIndex !== -1) {
      this._releaseGrab(hand);
    }
  },

  _startGrab: function (hand) {
    const gestoComp = this.detector.components['gesto-pellizco'];
    const handCollider = gestoComp.getHandCollider(hand);
    if (!handCollider) return;

    const handColliderEl = gestoComp.state[hand].colliderEntity;
    if (!handColliderEl) return;

    // ← CAMBIO: Solo aplicar límite si maxGrabbers NO es NaN
    if (!isNaN(this.data.maxGrabbers) && this.grabbers.length >= this.data.maxGrabbers) {
      const oldestGrabber = this.grabbers[0];
      console.log(`[grabbable] Máximo de agarres alcanzado (${this.data.maxGrabbers}), soltando mano ${oldestGrabber.hand}`);
      this._releaseGrab(oldestGrabber.hand);
    }

    const originalParent = this.el.object3D.parent;

    const objWorldPos = new THREE.Vector3();
    const objWorldQuat = new THREE.Quaternion();
    const objWorldScale = new THREE.Vector3();
    
    this.el.object3D.getWorldPosition(objWorldPos);
    this.el.object3D.getWorldQuaternion(objWorldQuat);
    this.el.object3D.getWorldScale(objWorldScale);

    if (this.data.suppressY && this.originalY === null) {
      this.originalY = this.el.object3D.position.y;
    }

    handColliderEl.object3D.add(this.el.object3D);

    const handInverseMatrix = new THREE.Matrix4();
    handInverseMatrix.copy(handColliderEl.object3D.matrixWorld).invert();
    
    let localPos = objWorldPos.clone().applyMatrix4(handInverseMatrix);
    
    if (this.data.invert) {
      localPos.multiplyScalar(-1);
    }
    
    this.el.object3D.position.copy(localPos);
    
    const handWorldQuat = new THREE.Quaternion();
    handColliderEl.object3D.getWorldQuaternion(handWorldQuat);
    const handInverseQuat = handWorldQuat.clone().invert();
    this.el.object3D.quaternion.copy(handInverseQuat).multiply(objWorldQuat);
    
    this.el.object3D.scale.copy(objWorldScale);

    const grabData = {
      hand: hand,
      colliderEntity: handColliderEl,
      originalParent: originalParent,
      localOffset: localPos.clone(),
      localRotation: this.el.object3D.quaternion.clone()
    };

    this.grabbers.push(grabData);

    console.log(`[grabbable] 🎯 AGARRADO por mano ${hand} (total agarres: ${this.grabbers.length})`);
    this.el.emit('grab-start', { hand, grabbers: this.grabbers.length }, false);
  },

  _releaseGrab: function (hand) {
    const grabberIndex = this.grabbers.findIndex(g => g.hand === hand);
    if (grabberIndex === -1) return;

    const grabData = this.grabbers[grabberIndex];

    if (this.grabbers.length === 1) {
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      
      this.el.object3D.getWorldPosition(worldPos);
      this.el.object3D.getWorldQuaternion(worldQuat);
      this.el.object3D.getWorldScale(worldScale);

      if (grabData.originalParent) {
        grabData.originalParent.add(this.el.object3D);
      } else {
        this.sceneEl.object3D.add(this.el.object3D);
      }

      const parentInverseMatrix = new THREE.Matrix4();
      const targetParent = grabData.originalParent || this.sceneEl.object3D;
      parentInverseMatrix.copy(targetParent.matrixWorld).invert();
      
      const localPos = worldPos.clone().applyMatrix4(parentInverseMatrix);
      this.el.object3D.position.copy(localPos);
      
      const parentWorldQuat = new THREE.Quaternion();
      targetParent.getWorldQuaternion(parentWorldQuat);
      const parentInverseQuat = parentWorldQuat.clone().invert();
      this.el.object3D.quaternion.copy(parentInverseQuat).multiply(worldQuat);
      
      this.el.object3D.scale.copy(worldScale);

      this.originalY = null;
    } else {
      // Si hay más agarres, transferir a la próxima mano activa
      const nextGrabber = this.grabbers.find((g, i) => i !== grabberIndex);
      if (nextGrabber) {
        console.log(`[grabbable] Transferir agarre de ${hand} a ${nextGrabber.hand}`);
        
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        this.el.object3D.getWorldPosition(worldPos);
        this.el.object3D.getWorldQuaternion(worldQuat);

        nextGrabber.colliderEntity.object3D.add(this.el.object3D);

        const handInverseMatrix = new THREE.Matrix4();
        handInverseMatrix.copy(nextGrabber.colliderEntity.object3D.matrixWorld).invert();
        this.el.object3D.position.copy(worldPos).applyMatrix4(handInverseMatrix);

        const handWorldQuat = new THREE.Quaternion();
        nextGrabber.colliderEntity.object3D.getWorldQuaternion(handWorldQuat);
        const handInverseQuat = handWorldQuat.clone().invert();
        this.el.object3D.quaternion.copy(handInverseQuat).multiply(worldQuat);
      }
    }

    this.grabbers.splice(grabberIndex, 1);

    console.log(`[grabbable] 🔓 SOLTADO por mano ${hand} (agarres restantes: ${this.grabbers.length})`);
    this.el.emit('grab-end', { hand, grabbers: this.grabbers.length }, false);
  }
});