/**
 * Componente: grabbable
 * Hace que un objeto pueda ser agarrado con diferentes gestos de mano.
 * Compatible con super-hands: solo añadir 'grabbable' al objeto.
 */
AFRAME.registerComponent('grabbable', {
  schema: {
    maxGrabbers: { type: 'int', default: 1 },
    invert: { type: 'boolean', default: false },
    suppressY: { type: 'boolean', default: false },
    colliderSize: { type: 'vec3', default: { x: 0.3, y: 0.3, z: 0.3 } },
    debug: { type: 'boolean', default: false },
    startGesture: { type: 'string', default: 'pinchstart' },
    endGesture: { type: 'string', default: 'pinchend' }
  },

  init: function () {
    this.sceneEl = this.el.sceneEl;

    if (this.sceneEl.hasLoaded) {
      this._setup();
    } else {
      this.sceneEl.addEventListener('loaded', () => this._setup());
    }
  },

  _setup: function () {
    this.detector = this._findDetector();

    if (!this.detector) {
      console.warn('[grabbable] No se encontró detector compatible. Creando detector automático con gesto-pellizco...');
      this._createDetector();
    }

    this.colliderType = this._detectColliderType();

    this.grabbers = [];
    this.originalY = null;
    this.inContact = { left: false, right: false };
    this.isGesturing = { left: false, right: false };

    this._ensureCollider();

    this._onGestureStart = this._onGestureStart.bind(this);
    this._onGestureEnd = this._onGestureEnd.bind(this);
    this._onStretchTransfer = this._onStretchTransfer.bind(this);

    this.detector.addEventListener(this.data.startGesture, this._onGestureStart);
    this.detector.addEventListener(this.data.endGesture, this._onGestureEnd);

    // ✅ NUEVO: Escuchar evento de transferencia de agarre desde stretchable
    this.el.addEventListener('stretch-transfer-grab', this._onStretchTransfer);

    const maxGrabbersText = isNaN(this.data.maxGrabbers) ? 'ilimitado' : this.data.maxGrabbers;
    console.log(`[grabbable] ✅ Inicializado en ${this.el.id || this.el.tagName}`);
    console.log(`  - Colisionador: ${this.colliderType}`);
    console.log(`  - maxGrabbers: ${maxGrabbersText}`);
    console.log(`  - invert: ${this.data.invert}`);
    console.log(`  - startGesture: ${this.data.startGesture}`);
    console.log(`  - endGesture: ${this.data.endGesture}`);
  },

  _findDetector: function () {
    const needsPinch = this.data.startGesture === 'pinchstart' || this.data.startGesture === 'pinchmove';
    const needsPoint = this.data.startGesture === 'pointstart' || this.data.startGesture === 'pointmove';

    let detector = document.getElementById('detector-pellizco');
    if (detector && needsPinch && detector.components['gesto-pellizco']) return detector;

    detector = document.getElementById('detector-apuntar');
    if (detector && needsPoint && detector.components['gesto-apuntar']) return detector;

    detector = document.getElementById('detector');
    if (detector) {
      if (needsPinch && detector.components['gesto-pellizco']) return detector;
      if (needsPoint && detector.components['gesto-apuntar']) return detector;
    }

    const entities = this.sceneEl.querySelectorAll('a-entity');
    for (let entity of entities) {
      if (needsPinch && entity.components['gesto-pellizco']) return entity;
      if (needsPoint && entity.components['gesto-apuntar']) return entity;
    }

    return null;
  },

  _detectColliderType: function () {
    const gestoComp = this.detector.components['gesto-pellizco'] ||
      this.detector.components['gesto-apuntar'];

    return gestoComp && gestoComp.data.colliderType ? gestoComp.data.colliderType : 'sat-collider';
  },

  _createDetector: function () {
    console.log('[grabbable] Creando detector automático con gesto-pellizco...');

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
      this.detector.removeEventListener(this.data.startGesture, this._onGestureStart);
      this.detector.removeEventListener(this.data.endGesture, this._onGestureEnd);
    }

    this.el.removeEventListener('stretch-transfer-grab', this._onStretchTransfer);

    while (this.grabbers.length > 0) {
      this._releaseGrab(this.grabbers[0].hand);
    }

    if (this.el.is('grabbed')) {
      this.el.removeState('grabbed');
      console.log(`[grabbable] ❌ Estado 'grabbed' eliminado (componente removido)`);
    }
  },

  _ensureCollider: function () {
    const hasCollider = this.el.components['sat-collider'] || this.el.components['obb-collider'];

    if (!hasCollider) {
      let size = this.data.colliderSize;

      const geometry = this.el.getAttribute('geometry');
      if (geometry) {
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

  tick: function () {
    if (!this.detector) return;

    // ✅ Si el objeto está en modo "stretched", NO mover (solo stretchable controla)
    if (this.el.is('stretched')) {
      const gestoComp = this.detector.components['gesto-pellizco'] ||
        this.detector.components['gesto-apuntar'];

      if (gestoComp && gestoComp.getHandCollider && this.colliderType === 'sat-collider') {
        const objectCollider = this.el.components['sat-collider'];
        if (objectCollider) {
          ['left', 'right'].forEach(h => {
            const handCollider = gestoComp.getHandCollider(h);
            if (handCollider) {
              const objectOBB = objectCollider.getOBB();
              this.inContact[h] = handCollider.testCollision(objectOBB);
            } else {
              this.inContact[h] = false;
            }
          });
        }
      }
      return; // ⚠️ SALIR SIN MOVER EL OBJETO NI VERIFICAR AGARRES
    }

    const gestoComp = this.detector.components['gesto-pellizco'] ||
      this.detector.components['gesto-apuntar'];

    if (!gestoComp || !gestoComp.getHandCollider) return;

    // Detección de colisión
    if (this.colliderType === 'sat-collider') {
      const objectCollider = this.el.components['sat-collider'];
      if (!objectCollider) return;

      ['left', 'right'].forEach(h => {
        const handCollider = gestoComp.getHandCollider(h);

        if (handCollider) {
          const wasInContact = this.inContact[h];
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
      if (!this.inContact[grabber.hand] || !this.isGesturing[grabber.hand]) {
        this._releaseGrab(grabber.hand);
      }
    }

    // Aplicar invert
    if (this.data.invert && this.grabbers.length > 0) {
      const grabber = this.grabbers[0];
      const handColliderEl = grabber.colliderEntity;

      const handWorldPos = new THREE.Vector3();
      handColliderEl.object3D.getWorldPosition(handWorldPos);

      const handInitialPos = grabber.handInitialWorld;
      const handMovement = new THREE.Vector3().subVectors(handWorldPos, handInitialPos);

      const invertedTargetPos = grabber.grabCenterWorld.clone().sub(handMovement);

      const parentInverseMatrix = new THREE.Matrix4();
      parentInverseMatrix.copy(handColliderEl.object3D.matrixWorld).invert();
      const localPos = invertedTargetPos.clone().applyMatrix4(parentInverseMatrix);

      this.el.object3D.position.copy(localPos);
    }

    // Aplicar suppressY
    if (this.data.suppressY && this.originalY !== null && this.grabbers.length > 0) {
      const worldPos = new THREE.Vector3();
      this.el.object3D.getWorldPosition(worldPos);

      worldPos.y = this.originalY;

      const parent = this.el.object3D.parent;
      const parentInverseMatrix = new THREE.Matrix4();
      parentInverseMatrix.copy(parent.matrixWorld).invert();
      const localPos = worldPos.clone().applyMatrix4(parentInverseMatrix);
      this.el.object3D.position.copy(localPos);
    }
  },

  _onGestureStart: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand) return;

    this.isGesturing[hand] = true;

    // ✅ CRÍTICO: Si ya hay un grabber, NO añadir la segunda mano
    if (this.grabbers.length > 0) {
      console.log(`[grabbable] ℹ️ Mano ${hand} detectada pero ya hay ${this.grabbers.length} grabber(s). Ignorando para permitir stretch.`);
      return;
    }

    const hasLimit = !isNaN(this.data.maxGrabbers);
    const belowLimit = !hasLimit || this.grabbers.length < this.data.maxGrabbers;

    if (this.inContact[hand] && belowLimit) {
      this._startGrab(hand);
    }
  },

  _onGestureEnd: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand) return;

    this.isGesturing[hand] = false;

    // ✅ Si está en modo stretched, NO soltar el grab aunque pierda el gesto
    if (this.el.is('stretched')) {
      console.log(`[grabbable] ℹ️ Mano ${hand} soltó gesto pero objeto en modo stretched. NO soltando grab.`);
      return;
    }

    const grabberIndex = this.grabbers.findIndex(g => g.hand === hand);
    if (grabberIndex !== -1) {
      this._releaseGrab(hand);
    }
  },

  // ✅ NUEVO: Manejar transferencia de agarre desde stretchable
  _onStretchTransfer: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand) return;

    console.log(`[grabbable] 🔄 Recibiendo transferencia de agarre para mano ${hand}`);

    // Si ya hay un grabber con esa mano, no hacer nada
    if (this.grabbers.find(g => g.hand === hand)) {
      console.log(`[grabbable] ℹ️ Mano ${hand} ya tiene agarre activo`);
      return;
    }

    // Si hay un grabber de otra mano, liberarlo primero
    if (this.grabbers.length > 0) {
      const oldHand = this.grabbers[0].hand;
      console.log(`[grabbable] 🔄 Liberando agarre anterior de mano ${oldHand}`);
      this._releaseGrab(oldHand);
    }

    // Iniciar nuevo agarre con la mano que queda
    if (this.isGesturing[hand] && this.inContact[hand]) {
      this._startGrab(hand);
    } else {
      console.log(`[grabbable] ⚠️ No se puede transferir agarre: mano ${hand} no cumple condiciones (gesto: ${this.isGesturing[hand]}, contacto: ${this.inContact[hand]})`);
    }
  },

  _startGrab: function (hand) {
    const gestoComp = this.detector.components['gesto-pellizco'] ||
      this.detector.components['gesto-apuntar'];

    const handCollider = gestoComp.getHandCollider(hand);
    if (!handCollider) return;

    const handColliderEl = gestoComp.state[hand].colliderEntity;
    if (!handColliderEl) return;

    const wasGrabbed = this.grabbers.length > 0;

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

    const handWorldPos = new THREE.Vector3();
    handColliderEl.object3D.getWorldPosition(handWorldPos);

    if (this.data.suppressY && this.originalY === null) {
      this.originalY = objWorldPos.y;
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
      localRotation: this.el.object3D.quaternion.clone(),
      grabCenterWorld: objWorldPos.clone(),
      handInitialWorld: handWorldPos.clone()
    };

    this.grabbers.push(grabData);

    if (!wasGrabbed) {
      this.el.addState('grabbed');
      console.log(`[grabbable] 📦 Estado 'grabbed' AÑADIDO`);
    }

    console.log(`[grabbable] 🎯 AGARRADO por mano ${hand} con gesto '${this.data.startGesture}' (total: ${this.grabbers.length})`);
    this.el.emit('grab-start', { hand, grabbers: this.grabbers.length, gesture: this.data.startGesture }, false);
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
    }

    this.grabbers.splice(grabberIndex, 1);

    if (this.grabbers.length === 0) {
      this.el.removeState('grabbed');
      console.log(`[grabbable] 📭 Estado 'grabbed' ELIMINADO`);
    }

    console.log(`[grabbable] 🔓 SOLTADO por mano ${hand} con gesto '${this.data.endGesture}' (restantes: ${this.grabbers.length})`);
    this.el.emit('grab-end', { hand, grabbers: this.grabbers.length, gesture: this.data.endGesture }, false);
  }
});