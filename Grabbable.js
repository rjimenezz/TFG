/**
 * Componente: grabbable
 * Hace que un objeto pueda ser agarrado con diferentes gestos de mano.
 * Usa automáticamente el mismo tipo de colisionador que el detector de gesto.
 */
AFRAME.registerComponent('grabbable', {
  schema: {
    maxGrabbers: { type: 'int', default: NaN },
    invert: { type: 'boolean', default: false },
    suppressY: { type: 'boolean', default: false },
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
      console.warn('[grabbable] No se encontró detector compatible.');
      return;
    }

    this.colliderType = this._detectColliderType();

    this.grabbers = [];
    this.originalY = null;
    this.inContact = { left: false, right: false };
    this.isGesturing = { left: false, right: false };
    // ✅ NUEVO: Rastrear si el contacto fue DESPUÉS del pellizco
    this.validContactForGrab = { left: false, right: false };

    this._ensureCollider();

    if (this.colliderType === 'obb-collider') {
      this._onOBBCollisionStart = this._onOBBCollisionStart.bind(this);
      this._onOBBCollisionEnd = this._onOBBCollisionEnd.bind(this);

      this.el.addEventListener('obbcollisionstarted', this._onOBBCollisionStart);
      this.el.addEventListener('obbcollisionended', this._onOBBCollisionEnd);
    }

    this._onGestureStart = this._onGestureStart.bind(this);
    this._onGestureEnd = this._onGestureEnd.bind(this);

    this.detector.addEventListener(this.data.startGesture, this._onGestureStart);
    this.detector.addEventListener(this.data.endGesture, this._onGestureEnd);

    const maxGrabbersText = isNaN(this.data.maxGrabbers) ? 'ilimitado' : this.data.maxGrabbers;
    console.log(`[grabbable] ✅ Inicializado en ${this.el.id || this.el.tagName}`);
    console.log(`  - Detector: ${this.detector.id || 'sin-id'}`);
    console.log(`  - Colisionador heredado: ${this.colliderType}`);
    console.log(`  - maxGrabbers: ${maxGrabbersText}`);
  },

  _findDetector: function () {
    const needsPinch = this.data.startGesture.startsWith('pinch');
    const needsPoint = this.data.startGesture.startsWith('point');

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

    const detectedType = gestoComp?.data.colliderType || 'sat-collider';
    console.log(`[grabbable] 🔍 Colisionador detectado del gesto: ${detectedType}`);
    return detectedType;
  },

  remove: function () {
    if (this.detector) {
      this.detector.removeEventListener(this.data.startGesture, this._onGestureStart);
      this.detector.removeEventListener(this.data.endGesture, this._onGestureEnd);
    }

    if (this.colliderType === 'obb-collider') {
      this.el.removeEventListener('obbcollisionstarted', this._onOBBCollisionStart);
      this.el.removeEventListener('obbcollisionended', this._onOBBCollisionEnd);
    }

    while (this.grabbers.length > 0) {
      this._releaseGrab(this.grabbers[0].hand);
    }

    if (this.el.is('grabbed')) {
      this.el.removeState('grabbed');
    }

    this.el.removeAttribute(this.colliderType);
  },

  _ensureCollider: function () {
    const hasCollider = this.el.components['sat-collider'] || this.el.components['obb-collider'];

    if (!hasCollider) {
      let size = { x: 0.3, y: 0.3, z: 0.3 };

      const geometry = this.el.getAttribute('geometry');
      if (geometry?.primitive === 'box') {
        size = {
          x: geometry.width || 1,
          y: geometry.height || 1,
          z: geometry.depth || 1
        };
      } else if (geometry?.primitive === 'sphere') {
        const r = (geometry.radius || 0.5) * 2;
        size = { x: r, y: r, z: r };
      }

      console.log(`[grabbable] ➕ Añadiendo ${this.colliderType} con tamaño:`, size);

      if (this.colliderType === 'obb-collider') {
        if (!geometry) {
          this.el.setAttribute('geometry', {
            primitive: 'box',
            width: size.x,
            height: size.y,
            depth: size.z
          });
        }

        this.el.setAttribute('obb-collider', {
          trackedObject3D: 'mesh'
        });

        const existingMaterial = this.el.getAttribute('material');
        if (!existingMaterial || existingMaterial.visible === false) {
          if (this.data.debug) {
            this.el.setAttribute('material', {
              color: '#0f0',
              opacity: 0.3,
              transparent: true,
              wireframe: true
            });
          } else {
            this.el.setAttribute('material', {
              visible: false,
              transparent: true,
              opacity: 0
            });
          }
        }
      } else {
        const colliderConfig = `size: ${size.x} ${size.y} ${size.z}; debug: ${this.data.debug}`;
        this.el.setAttribute('sat-collider', colliderConfig);
      }
    } else {
      console.log(`[grabbable] ✓ Ya tiene colisionador: ${hasCollider.name}`);
    }
  },

  _onOBBCollisionStart: function (e) {
    const collidedWith = e.detail.withEl;
    if (collidedWith?.id.startsWith('hand-collider-') || collidedWith?.id.startsWith('hand-point-collider-')) {
      const hand = collidedWith.id.includes('left') ? 'left' : 'right';
      this.inContact[hand] = true;

      // ✅ NUEVO: Solo válido si NO está pellizcando
      if (!this.isGesturing[hand]) {
        this.validContactForGrab[hand] = true;
        console.log(`[grabbable] 🟢 CONTACTO VÁLIDO - Mano ${hand} (sin pellizco previo)`);
      } else {
        this.validContactForGrab[hand] = false;
        console.log(`[grabbable] 🟡 CONTACTO - Mano ${hand} (pero ya estaba pellizcando, NO válido para grab)`);
      }
    }
  },

  _onOBBCollisionEnd: function (e) {
    const collidedWith = e.detail.withEl;
    if (collidedWith?.id.startsWith('hand-collider-') || collidedWith?.id.startsWith('hand-point-collider-')) {
      const hand = collidedWith.id.includes('left') ? 'left' : 'right';
      this.inContact[hand] = false;
      this.validContactForGrab[hand] = false;
      console.log(`[grabbable] 🔴 SIN CONTACTO - Mano ${hand}`);
    }
  },

  tick: function () {
    if (!this.detector) return;

    const gestoComp = this.detector.components['gesto-pellizco'] ||
      this.detector.components['gesto-apuntar'];

    if (!gestoComp?.getHandCollider) return;

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
            // ✅ NUEVO: Solo válido si NO está pellizcando
            if (!this.isGesturing[h]) {
              this.validContactForGrab[h] = true;
              console.log(`[grabbable] 🟢 CONTACTO VÁLIDO - Mano ${h} (sin pellizco previo)`);
            } else {
              this.validContactForGrab[h] = false;
              console.log(`[grabbable] 🟡 CONTACTO - Mano ${h} (pero ya estaba pellizcando, NO válido)`);
            }
          } else if (!this.inContact[h] && wasInContact) {
            this.validContactForGrab[h] = false;
            console.log(`[grabbable] 🔴 SIN CONTACTO - Mano ${h}`);
          }
        } else {
          this.inContact[h] = false;
          this.validContactForGrab[h] = false;
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

      const handMovement = new THREE.Vector3().subVectors(handWorldPos, grabber.handInitialWorld);
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
    const hand = e.detail?.hand;
    if (!hand) return;

    this.isGesturing[hand] = true;

    // ✅ NUEVO: Si hace contacto DESPUÉS de empezar a pellizcar, marcarlo como válido
    if (this.inContact[hand] && !this.validContactForGrab[hand]) {
      console.log(`[grabbable] ⚠️ Pellizco iniciado CON contacto previo - Mano ${hand} - Se requiere re-contacto`);
      return;
    }

    const hasLimit = !isNaN(this.data.maxGrabbers);
    const belowLimit = !hasLimit || this.grabbers.length < this.data.maxGrabbers;

    // ✅ NUEVO: Solo agarrar si tiene contacto VÁLIDO
    if (this.inContact[hand] && this.validContactForGrab[hand] && belowLimit) {
      this._startGrab(hand);
    }
  },

  _onGestureEnd: function (e) {
    const hand = e.detail?.hand;
    if (!hand) return;

    this.isGesturing[hand] = false;

    // ✅ NUEVO: Al soltar pellizco, si sigue en contacto, marcar como válido para próximo grab
    if (this.inContact[hand]) {
      this.validContactForGrab[hand] = true;
      console.log(`[grabbable] ✅ Pellizco terminado con contacto - Mano ${hand} - Listo para nuevo grab`);
    }

    const grabberIndex = this.grabbers.findIndex(g => g.hand === hand);
    if (grabberIndex !== -1) {
      this._releaseGrab(hand);
    }
  },

  _startGrab: function (hand) {
    const gestoComp = this.detector.components['gesto-pellizco'] ||
      this.detector.components['gesto-apuntar'];

    const handColliderEl = gestoComp.state[hand].colliderEntity;
    if (!handColliderEl) return;

    const wasGrabbed = this.grabbers.length > 0;

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
    }

    console.log(`[grabbable] 🎯 AGARRADO por mano ${hand}`);
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
      // ✅ ARREGLADO: Transferir al PRIMER grabber restante (el más antiguo)
      const remainingGrabbers = this.grabbers.filter((g, i) => i !== grabberIndex);
      const nextGrabber = remainingGrabbers[0]; // El más antiguo

      if (nextGrabber) {
        console.log(`[grabbable] 🔄 Transferir agarre de ${hand} a ${nextGrabber.hand} (primera mano)`);

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

    if (this.grabbers.length === 0) {
      this.el.removeState('grabbed');
    }

    console.log(`[grabbable] 🔓 SOLTADO por mano ${hand}`);
    this.el.emit('grab-end', { hand, grabbers: this.grabbers.length }, false);
  }
});