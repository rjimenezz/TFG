/**
 * Componente: stretchable
 * Permite escalar un objeto con dos manos mientras está agarrado.
 * Usa automáticamente el mismo tipo de colisionador que el detector de gesto.
 */
AFRAME.registerComponent('stretchable', {
    schema: {
        invert: { type: 'boolean', default: false },
        minScale: { type: 'number', default: 0.1 },
        maxScale: { type: 'number', default: 10.0 },
        startGesture: { type: 'string', default: 'pinchstart' },
        endGesture: { type: 'string', default: 'pinchend' }
    },

    init: function () {
        this.sceneEl = this.el.sceneEl;
        this.detector = null;
        this.colliderType = null;

        this.stretching = false;
        this.initialDistance = null;
        this.initialScale = null;
        this.fixedWorldPos = null;
        this.fixedWorldQuat = null;
        this.baseColliderSize = null;

        this.inContact = { left: false, right: false };
        this.isPinching = { left: false, right: false };
        // ✅ NUEVO: Rastrear si el contacto fue DESPUÉS del pellizco
        this.validContactForStretch = { left: false, right: false };

        if (this.sceneEl.hasLoaded) {
            this._setup();
        } else {
            this.sceneEl.addEventListener('loaded', () => this._setup());
        }
    },

    _setup: function () {
        this.detector = this._findDetector();
        if (!this.detector) {
            console.warn('[stretchable] No detector encontrado');
            return;
        }

        this.colliderType = this._detectColliderType();

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

        console.log(`[stretchable] ✅ Inicializado`);
        console.log(`  - Detector: ${this.detector.id || 'sin-id'}`);
        console.log(`  - Colisionador heredado: ${this.colliderType}`);
    },

    _findDetector: function () {
        const needsPinch = this.data.startGesture.startsWith('pinch');
        const needsPoint = this.data.startGesture.startsWith('point');

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

        const detectedType = gestoComp?.data.colliderType || 'sat-collider';
        console.log(`[stretchable] 🔍 Colisionador detectado del gesto: ${detectedType}`);
        return detectedType;
    },

    _onOBBCollisionStart: function (e) {
        const collidedWith = e.detail.withEl;
        if (collidedWith?.id.startsWith('hand-collider-') || collidedWith?.id.startsWith('hand-point-collider-')) {
            const hand = collidedWith.id.includes('left') ? 'left' : 'right';
            this.inContact[hand] = true;

            // ✅ NUEVO: Solo válido si NO está pellizcando
            if (!this.isPinching[hand]) {
                this.validContactForStretch[hand] = true;
                console.log(`[stretchable] 🟢 CONTACTO VÁLIDO - Mano ${hand} (sin pellizco previo)`);
            } else {
                this.validContactForStretch[hand] = false;
                console.log(`[stretchable] 🟡 CONTACTO - Mano ${hand} (pero ya estaba pellizcando, NO válido para stretch)`);
            }
        }
    },

    _onOBBCollisionEnd: function (e) {
        const collidedWith = e.detail.withEl;
        if (collidedWith?.id.startsWith('hand-collider-') || collidedWith?.id.startsWith('hand-point-collider-')) {
            const hand = collidedWith.id.includes('left') ? 'left' : 'right';
            this.inContact[hand] = false;
            this.validContactForStretch[hand] = false;
            console.log(`[stretchable] 🔴 SIN CONTACTO - Mano ${hand}`);

            // ✅ ARREGLADO: Terminar stretch si pierde contacto
            if (this.stretching) {
                console.log(`[stretchable] ⚠️ Stretch cancelado - Mano ${hand} perdió contacto`);
                this._endStretch();
            }
        }
    },

    tick: function () {
        if (!this.detector) return;
        const gestoComp = this.detector.components['gesto-pellizco'] ||
            this.detector.components['gesto-apuntar'];
        if (!gestoComp || !gestoComp.getHandCollider) return;

        if (!this.el.is('grabbed')) {
            if (this.stretching) this._endStretch();
            return;
        }

        if (this.colliderType === 'sat-collider') {
            const objectCollider = this.el.components['sat-collider'];
            if (!objectCollider) return;

            if (objectCollider.updateOBB) objectCollider.updateOBB();

            ['left', 'right'].forEach(hand => {
                const handCollider = gestoComp.getHandCollider(hand);
                const wasInContact = this.inContact[hand];

                if (handCollider) {
                    const objectOBB = objectCollider.getOBB();
                    this.inContact[hand] = handCollider.testCollision(objectOBB);

                    if (this.inContact[hand] && !wasInContact) {
                        // ✅ NUEVO: Solo válido si NO está pellizcando
                        if (!this.isPinching[hand]) {
                            this.validContactForStretch[hand] = true;
                            console.log(`[stretchable] 🟢 CONTACTO VÁLIDO - Mano ${hand} (sin pellizco previo)`);
                        } else {
                            this.validContactForStretch[hand] = false;
                            console.log(`[stretchable] 🟡 CONTACTO - Mano ${hand} (pero ya estaba pellizcando, NO válido)`);
                        }
                    } else if (!this.inContact[hand] && wasInContact) {
                        this.validContactForStretch[hand] = false;
                        console.log(`[stretchable] 🔴 SIN CONTACTO - Mano ${hand}`);

                        // ✅ ARREGLADO: Terminar stretch si pierde contacto
                        if (this.stretching) {
                            console.log(`[stretchable] ⚠️ Stretch cancelado - Mano ${hand} perdió contacto`);
                            this._endStretch();
                        }
                    }
                } else {
                    this.inContact[hand] = false;
                    this.validContactForStretch[hand] = false;
                }
            });
        }

        // ✅ ARREGLADO: Solo permite stretch si ambas manos tienen contacto VÁLIDO
        const bothCanStretch = this.inContact.left && this.inContact.right &&
            this.isPinching.left && this.isPinching.right &&
            this.validContactForStretch.left && this.validContactForStretch.right;

        if (bothCanStretch && !this.stretching) {
            this._startStretch();
        }

        if (this.stretching && !bothCanStretch) {
            this._endStretch();
        }

        if (this.stretching) {
            this._processStretch();
            this._lockPosition();
        }
    },

    _onGestureStart: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;
        this.isPinching[hand] = true;

        // ✅ NUEVO: Si hace contacto DESPUÉS de empezar a pellizcar, NO marcar como válido
        if (this.inContact[hand] && !this.validContactForStretch[hand]) {
            console.log(`[stretchable] ⚠️ Pellizco iniciado CON contacto previo - Mano ${hand} - Se requiere re-contacto`);
            return;
        }

        if (this.inContact[hand] && this.validContactForStretch[hand]) {
            console.log(`[stretchable] ✅ Pellizco válido para stretch - Mano ${hand}`);
        }
    },

    _onGestureEnd: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;
        this.isPinching[hand] = false;

        // ✅ NUEVO: Al soltar pellizco, si sigue en contacto, marcar como válido
        if (this.inContact[hand]) {
            this.validContactForStretch[hand] = true;
            console.log(`[stretchable] ✅ Pellizco terminado con contacto - Mano ${hand} - Listo para stretch`);
        } else {
            this.validContactForStretch[hand] = false;
        }

        if (this.stretching) {
            console.log(`[stretchable] ⚠️ Stretch cancelado - Mano ${hand} soltó pellizco`);
            this._endStretch();
        }
    },

    _startStretch: function () {
        this.fixedWorldPos = new THREE.Vector3();
        this.fixedWorldQuat = new THREE.Quaternion();

        this.el.object3D.getWorldPosition(this.fixedWorldPos);
        this.el.object3D.getWorldQuaternion(this.fixedWorldQuat);

        this.initialScale = this.el.object3D.scale.clone();
        this.initialDistance = null;

        if (this.colliderType === 'obb-collider') {
            const geometry = this.el.getAttribute('geometry');
            if (geometry && geometry.primitive === 'box') {
                this.baseColliderSize = {
                    x: geometry.width || 1,
                    y: geometry.height || 1,
                    z: geometry.depth || 1
                };
            }
        } else if (this.colliderType === 'sat-collider') {
            const objectCollider = this.el.components['sat-collider'];
            if (objectCollider?.data?.size) {
                this.baseColliderSize = {
                    x: objectCollider.data.size.x,
                    y: objectCollider.data.size.y,
                    z: objectCollider.data.size.z
                };
            }
        }

        this.stretching = true;
        this.el.addState('stretched');

        console.log(`[stretchable] 🔀 STRETCH INICIADO - Ambas manos con contacto válido`);
        this.el.emit('stretch-start', { initialScale: this.initialScale.clone() }, false);
    },

    _processStretch: function () {
        const gestoComp = this.detector.components['gesto-pellizco'] ||
            this.detector.components['gesto-apuntar'];
        const collider1 = gestoComp.state.left.colliderEntity;
        const collider2 = gestoComp.state.right.colliderEntity;

        if (!collider1 || !collider2) return;

        const pos1 = new THREE.Vector3();
        const pos2 = new THREE.Vector3();

        collider1.object3D.getWorldPosition(pos1);
        collider2.object3D.getWorldPosition(pos2);

        const currentDistance = pos1.distanceTo(pos2);

        if (this.initialDistance === null) {
            this.initialDistance = currentDistance;
            return;
        }

        let scaleFactor = currentDistance / this.initialDistance;
        if (this.data.invert) scaleFactor = 1 / scaleFactor;

        const newScale = this.initialScale.clone().multiplyScalar(scaleFactor);
        newScale.x = THREE.MathUtils.clamp(newScale.x, this.data.minScale, this.data.maxScale);
        newScale.y = THREE.MathUtils.clamp(newScale.y, this.data.minScale, this.data.maxScale);
        newScale.z = THREE.MathUtils.clamp(newScale.z, this.data.minScale, this.data.maxScale);

        this.el.object3D.scale.copy(newScale);

        this._updateColliderSize(newScale);

        this.el.emit('stretch', { scale: newScale.clone(), scaleFactor }, false);
    },

    _lockPosition: function () {
        if (!this.fixedWorldPos || !this.fixedWorldQuat) return;

        const parent = this.el.object3D.parent;

        if (!parent || !parent.matrixWorld) {
            return;
        }

        parent.updateMatrixWorld(true);

        const parentInverseMatrix = new THREE.Matrix4();
        parentInverseMatrix.copy(parent.matrixWorld).invert();

        const localPos = this.fixedWorldPos.clone().applyMatrix4(parentInverseMatrix);
        this.el.object3D.position.copy(localPos);

        const parentWorldQuat = new THREE.Quaternion();
        parent.getWorldQuaternion(parentWorldQuat);
        const parentInverseQuat = parentWorldQuat.clone().invert();
        this.el.object3D.quaternion.copy(parentInverseQuat).multiply(this.fixedWorldQuat);
    },

    _updateColliderSize: function (newScale) {
        if (!this.baseColliderSize) return;

        if (this.colliderType === 'obb-collider') {
            const newSize = {
                x: this.baseColliderSize.x * newScale.x,
                y: this.baseColliderSize.y * newScale.y,
                z: this.baseColliderSize.z * newScale.z
            };

            this.el.setAttribute('geometry', {
                width: newSize.x,
                height: newSize.y,
                depth: newSize.z
            });

        } else if (this.colliderType === 'sat-collider') {
            const objectCollider = this.el.components['sat-collider'];
            if (!objectCollider) return;

            const newColliderSize = {
                x: this.baseColliderSize.x * newScale.x,
                y: this.baseColliderSize.y * newScale.y,
                z: this.baseColliderSize.z * newScale.z
            };

            objectCollider.el.setAttribute('sat-collider', {
                size: newColliderSize,
                debug: objectCollider.data.debug
            });

            objectCollider.obb.size.copy(new THREE.Vector3(newColliderSize.x, newColliderSize.y, newColliderSize.z));
            objectCollider.obb.halfSize.set(
                newColliderSize.x / 2,
                newColliderSize.y / 2,
                newColliderSize.z / 2
            );

            if (objectCollider.updateOBB) {
                objectCollider.updateOBB();
            }
        }
    },

    _endStretch: function () {
        if (!this.stretching) return;

        this.stretching = false;
        this.initialDistance = null;
        this.fixedWorldPos = null;
        this.fixedWorldQuat = null;
        this.baseColliderSize = null;

        this.el.removeState('stretched');

        console.log(`[stretchable] 🔚 STRETCH FINALIZADO`);
        this.el.emit('stretch-end', { finalScale: this.el.object3D.scale.clone() }, false);
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

        if (this.stretching) {
            this._endStretch();
        }
    }
});