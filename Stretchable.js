/**
 * Componente: stretchable
 * Permite escalar un objeto con dos manos mientras está agarrado.
 * Compatible con grabbable - usa ambas manos para escalar.
 * NO incluye física.
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
        this.stretchers = [];
        this.initialDistance = null;
        this.initialScale = null;
        this.isStretching = false;
        this.isGesturing = { left: false, right: false };
        this.inContact = { left: false, right: false };
        this.baseColliderSize = null;
        this.stretchStartTransform = null;

        if (this.sceneEl.hasLoaded) {
            this._setup();
        } else {
            this.sceneEl.addEventListener('loaded', () => this._setup());
        }
    },

    _setup: function () {
        this.detector = this._findDetector();
        if (!this.detector) {
            console.warn('[stretchable] No se encontró detector compatible.');
            return;
        }
        this.colliderType = this._detectColliderType();

        this._onGestureStart = this._onGestureStart.bind(this);
        this._onGestureEnd = this._onGestureEnd.bind(this);
        this._onGestureMove = this._onGestureMove.bind(this);

        this.detector.addEventListener(this.data.startGesture, this._onGestureStart);
        this.detector.addEventListener(this.data.endGesture, this._onGestureEnd);
        const moveEvent = this.data.startGesture.replace('start', 'move');
        this.detector.addEventListener(moveEvent, this._onGestureMove);

        this.el.addEventListener('stateadded', (e) => {
            if (e.detail === 'grabbed') this._checkStretchState();
        });
        this.el.addEventListener('stateremoved', (e) => {
            if (e.detail === 'grabbed') this._endStretch();
        });

        console.log(`[stretchable] ✅ Inicializado`);
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
        return gestoComp && gestoComp.data.colliderType ? gestoComp.data.colliderType : 'sat-collider';
    },

    remove: function () {
        if (this.detector) {
            this.detector.removeEventListener(this.data.startGesture, this._onGestureStart);
            this.detector.removeEventListener(this.data.endGesture, this._onGestureEnd);
            const moveEvent = this.data.startGesture.replace('start', 'move');
            this.detector.removeEventListener(moveEvent, this._onGestureMove);
        }
        this._endStretch();
    },

    tick: function () {
        if (!this.detector) return;
        const gestoComp = this.detector.components['gesto-pellizco'] || this.detector.components['gesto-apuntar'];
        if (!gestoComp || !gestoComp.getHandCollider) return;

        // Actualizar contacto real de cada mano
        if (this.colliderType === 'sat-collider') {
            const objectCollider = this.el.components['sat-collider'];
            if (objectCollider) {
                ['left', 'right'].forEach(h => {
                    const handCollider = gestoComp.getHandCollider(h);
                    if (handCollider && this.isGesturing[h]) {
                        const objectOBB = objectCollider.getOBB();
                        this.inContact[h] = handCollider.testCollision(objectOBB);
                    } else {
                        this.inContact[h] = false;
                    }
                });
            }
        }

        // Si está en modo stretch, comprobar condiciones cada frame
        if (this.isStretching) {
            if (!this.el.is('grabbed')) {
                this._endStretch();
                return;
            }

            for (const hand of this.stretchers) {
                if (!this.isGesturing[hand] || !this.inContact[hand]) {
                    console.log(`[stretchable] ⚠️ Mano ${hand} perdió gesto o contacto, cancelando stretch`);
                    this._endStretch();
                    return;
                }
            }

            // ✅ Mantener posición/rotación fija en ESPACIO MUNDIAL durante stretch
            if (this.stretchStartTransform) {
                const currentWorldPos = new THREE.Vector3();
                const currentWorldQuat = new THREE.Quaternion();

                this.el.object3D.getWorldPosition(currentWorldPos);
                this.el.object3D.getWorldQuaternion(currentWorldQuat);

                // Si la posición mundial cambió, restaurarla
                if (currentWorldPos.distanceTo(this.stretchStartTransform.worldPosition) > 0.001 ||
                    currentWorldQuat.angleTo(this.stretchStartTransform.worldQuaternion) > 0.01) {

                    // Convertir posición mundial a local del padre actual
                    const parent = this.el.object3D.parent;
                    const parentInverseMatrix = new THREE.Matrix4();
                    parentInverseMatrix.copy(parent.matrixWorld).invert();

                    const localPos = this.stretchStartTransform.worldPosition.clone().applyMatrix4(parentInverseMatrix);
                    this.el.object3D.position.copy(localPos);

                    // Convertir rotación mundial a local del padre actual
                    const parentWorldQuat = new THREE.Quaternion();
                    parent.getWorldQuaternion(parentWorldQuat);
                    const parentInverseQuat = parentWorldQuat.clone().invert();
                    this.el.object3D.quaternion.copy(parentInverseQuat).multiply(this.stretchStartTransform.worldQuaternion);
                }
            }
        }

        // Solo procesar stretch si hay exactamente 2 manos válidas
        if (this.isStretching && this.stretchers.length === 2) {
            const hand1 = this.stretchers[0];
            const hand2 = this.stretchers[1];
            const collider1 = gestoComp.state[hand1].colliderEntity;
            const collider2 = gestoComp.state[hand2].colliderEntity;
            if (!collider1 || !collider2) return;

            const pos1 = new THREE.Vector3();
            const pos2 = new THREE.Vector3();
            collider1.object3D.getWorldPosition(pos1);
            collider2.object3D.getWorldPosition(pos2);

            const currentDistance = pos1.distanceTo(pos2);

            if (this.initialDistance === null) {
                this.initialDistance = currentDistance;
                this.initialScale = this.el.object3D.scale.clone();
                this._storeBaseColliderSize();
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

            const scaleChange = Math.abs(scaleFactor - 1.0);
            if (scaleChange > 0.01) {
                this.el.emit('stretch', {
                    scale: newScale.clone(),
                    scaleFactor: scaleFactor,
                    distance: currentDistance,
                    hands: [hand1, hand2]
                }, false);
            }
        }

        this._checkStretchState();
    },

    _onGestureStart: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;
        this.isGesturing[hand] = true;
        this._checkStretchState();
    },

    _onGestureMove: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;
        this.isGesturing[hand] = true;
    },

    _onGestureEnd: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;
        this.isGesturing[hand] = false;
        this.inContact[hand] = false;
        this._checkStretchState();
    },

    _checkStretchState: function () {
        ['left', 'right'].forEach(hand => {
            const idx = this.stretchers.indexOf(hand);
            const shouldBe = this.el.is('grabbed') && this.isGesturing[hand] && this.inContact[hand];
            if (shouldBe && idx === -1) {
                this.stretchers.push(hand);
                console.log(`[stretchable] ✋ Mano ${hand} añadida a stretchers (total: ${this.stretchers.length})`);
            } else if (!shouldBe && idx !== -1) {
                this.stretchers.splice(idx, 1);
                console.log(`[stretchable] 🚫 Mano ${hand} eliminada de stretchers (restantes: ${this.stretchers.length})`);
            }
        });

        if (this.stretchers.length === 2 && !this.isStretching) {
            this._startStretch();
        }
        if (this.stretchers.length < 2 && this.isStretching) {
            this._endStretch();
        }
    },

    _storeBaseColliderSize: function () {
        const objectCollider = this.el.components['sat-collider'];
        if (!objectCollider) return;
        this.baseColliderSize = {
            x: objectCollider.data.size.x,
            y: objectCollider.data.size.y,
            z: objectCollider.data.size.z
        };
    },

    _updateColliderSize: function (newScale) {
        if (!this.baseColliderSize) return;
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
    },

    _startStretch: function () {
        if (this.stretchers.length !== 2) return;

        this.isStretching = true;
        this.initialDistance = null;
        this.initialScale = this.el.object3D.scale.clone();

        // ✅ Guardar posición/rotación en ESPACIO MUNDIAL
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        this.el.object3D.getWorldPosition(worldPos);
        this.el.object3D.getWorldQuaternion(worldQuat);

        this.stretchStartTransform = {
            worldPosition: worldPos.clone(),
            worldQuaternion: worldQuat.clone()
        };

        this.el.addState('stretched');

        console.log(`[stretchable] 🔀 STRETCH INICIADO con manos: ${this.stretchers.join(', ')}`);
        this.el.emit('stretch-start', {
            hands: [...this.stretchers],
            initialScale: this.initialScale.clone(),
            gesture: this.data.startGesture
        }, false);
    },

    _endStretch: function () {
        if (!this.isStretching) return;

        this.isStretching = false;
        this.initialDistance = null;
        this.baseColliderSize = null;
        this.stretchStartTransform = null;

        // ✅ NUEVO: Si queda una mano activa, transferir el agarre a esa mano
        const remainingHand = this.stretchers.find(h => this.isGesturing[h] && this.inContact[h]);

        this.el.removeState('stretched');

        console.log(`[stretchable] 🔚 STRETCH FINALIZADO`);

        // ✅ Si hay una mano que sigue pellizcando, notificar a grabbable para que la agarre
        if (remainingHand) {
            console.log(`[stretchable] 🔄 Transfiriendo agarre a mano ${remainingHand}`);
            this.el.emit('stretch-transfer-grab', { hand: remainingHand }, false);
        }

        this.el.emit('stretch-end', {
            finalScale: this.el.object3D.scale.clone(),
            remainingHand: remainingHand
        }, false);

        this.initialScale = null;
        this.stretchers = [];
    }
});