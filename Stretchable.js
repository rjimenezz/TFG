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

        if (this.sceneEl.hasLoaded) {
            this._setup();
        } else {
            this.sceneEl.addEventListener('loaded', () => this._setup());
        }
    },

    _setup: function () {
        this.detector = this._findDetector();

        if (!this.detector) {
            console.warn('[stretchable] No se encontró detector compatible. Usa el mismo detector que grabbable.');
            return;
        }

        this.colliderType = this._detectColliderType();

        this.stretchers = [];
        this.initialDistance = null;
        this.initialScale = null;
        this.isStretching = false;

        // ✅ Rastrear estado de gestos Y contacto
        this.isGesturing = { left: false, right: false };
        this.inContact = { left: false, right: false };

        // ✅ Guardar tamaño base del colisionador
        this.baseColliderSize = null;

        this._onGestureStart = this._onGestureStart.bind(this);
        this._onGestureEnd = this._onGestureEnd.bind(this);
        this._onGestureMove = this._onGestureMove.bind(this);

        this.detector.addEventListener(this.data.startGesture, this._onGestureStart);
        this.detector.addEventListener(this.data.endGesture, this._onGestureEnd);

        const moveEvent = this.data.startGesture.replace('start', 'move');
        this.detector.addEventListener(moveEvent, this._onGestureMove);

        console.log(`[stretchable] ✅ Inicializado en ${this.el.id || this.el.tagName}`);
        console.log(`  - colliderType: ${this.colliderType}`);
        console.log(`  - invert: ${this.data.invert}`);
        console.log(`  - minScale: ${this.data.minScale}`);
        console.log(`  - maxScale: ${this.data.maxScale}`);
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

    remove: function () {
        if (this.detector) {
            this.detector.removeEventListener(this.data.startGesture, this._onGestureStart);
            this.detector.removeEventListener(this.data.endGesture, this._onGestureEnd);
            const moveEvent = this.data.startGesture.replace('start', 'move');
            this.detector.removeEventListener(moveEvent, this._onGestureMove);
        }

        if (this.el.is('stretched')) {
            this.el.removeState('stretched');
        }
    },

    tick: function () {
        if (!this.detector) return;

        const gestoComp = this.detector.components['gesto-pellizco'] ||
            this.detector.components['gesto-apuntar'];

        if (!gestoComp || !gestoComp.getHandCollider) return;

        // ✅ Verificar contacto de cada mano CON el objeto
        if (this.colliderType === 'sat-collider') {
            const objectCollider = this.el.components['sat-collider'];
            if (objectCollider) {
                ['left', 'right'].forEach(h => {
                    const handCollider = gestoComp.getHandCollider(h);

                    if (handCollider && this.isGesturing[h]) {
                        const wasInContact = this.inContact[h];
                        const objectOBB = objectCollider.getOBB();
                        this.inContact[h] = handCollider.testCollision(objectOBB);

                        // ✅ Si pierde contacto DURANTE stretch, eliminarla
                        if (wasInContact && !this.inContact[h] && this.isStretching) {
                            const stretcherIndex = this.stretchers.indexOf(h);
                            if (stretcherIndex !== -1) {
                                console.log(`[stretchable] 🔴 Mano ${h} perdió contacto durante stretch, cancelando`);
                                this._removeStretcher(h);
                            }
                        }
                    } else {
                        this.inContact[h] = false;
                    }
                });
            }
        }

        // ✅ Verificar que ambas manos sigan haciendo el gesto Y tengan contacto
        if (this.isStretching) {
            const hand1 = this.stretchers[0];
            const hand2 = this.stretchers[1];

            // Si alguna mano deja de hacer el gesto, cancelar stretch
            if (!this.isGesturing[hand1] || !this.isGesturing[hand2]) {
                const stoppedHand = !this.isGesturing[hand1] ? hand1 : hand2;
                console.log(`[stretchable] ⚠️ Mano ${stoppedHand} dejó de hacer el gesto, cancelando stretch`);
                this._endStretch();
                return;
            }

            // ✅ NUEVO: Si alguna mano pierde contacto, cancelar stretch
            if (!this.inContact[hand1] || !this.inContact[hand2]) {
                const lostContactHand = !this.inContact[hand1] ? hand1 : hand2;
                console.log(`[stretchable] ⚠️ Mano ${lostContactHand} perdió contacto, cancelando stretch`);
                this._endStretch();
                return;
            }
        }

        // Solo procesar stretch si hay exactamente 2 manos
        if (!this.isStretching || this.stretchers.length !== 2) return;

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

            console.log(`[stretchable] 📏 Distancia inicial: ${this.initialDistance.toFixed(3)}m`);
            return;
        }

        let scaleFactor = currentDistance / this.initialDistance;

        if (this.data.invert) {
            scaleFactor = 1 / scaleFactor;
        }

        const newScale = this.initialScale.clone().multiplyScalar(scaleFactor);

        newScale.x = THREE.MathUtils.clamp(newScale.x, this.data.minScale, this.data.maxScale);
        newScale.y = THREE.MathUtils.clamp(newScale.y, this.data.minScale, this.data.maxScale);
        newScale.z = THREE.MathUtils.clamp(newScale.z, this.data.minScale, this.data.maxScale);

        this.el.object3D.scale.copy(newScale);

        // Actualizar el colisionador con el nuevo tamaño escalado
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
    },

    _storeBaseColliderSize: function () {
        const objectCollider = this.el.components['sat-collider'];
        if (!objectCollider) return;

        this.baseColliderSize = {
            x: objectCollider.data.size.x,
            y: objectCollider.data.size.y,
            z: objectCollider.data.size.z
        };

        console.log(`[stretchable] 💾 Tamaño base del colisionador guardado:`, this.baseColliderSize);
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
    },

    _onGestureStart: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;

        this.isGesturing[hand] = true;

        if (!this.el.is('grabbed')) {
            return;
        }

        if (!this.stretchers.includes(hand)) {
            this.stretchers.push(hand);
            console.log(`[stretchable] ✋ Mano ${hand} añadida (total: ${this.stretchers.length})`);
        }

        if (this.stretchers.length === 2 && !this.isStretching) {
            this._startStretch();
        }
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

        this._removeStretcher(hand);
    },

    _removeStretcher: function (hand) {
        const index = this.stretchers.indexOf(hand);
        if (index !== -1) {
            this.stretchers.splice(index, 1);
            console.log(`[stretchable] 🚫 Mano ${hand} eliminada (restantes: ${this.stretchers.length})`);

            if (this.stretchers.length < 2 && this.isStretching) {
                this._endStretch();
            }
        }
    },

    _startStretch: function () {
        if (this.stretchers.length !== 2) {
            console.warn('[stretchable] ⚠️ Se necesitan exactamente 2 manos para stretch');
            return;
        }

        const hand1 = this.stretchers[0];
        const hand2 = this.stretchers[1];

        if (!this.isGesturing[hand1] || !this.isGesturing[hand2]) {
            console.warn('[stretchable] ⚠️ Ambas manos deben estar haciendo el gesto');
            return;
        }

        this.isStretching = true;
        this.initialDistance = null;
        this.initialScale = this.el.object3D.scale.clone();

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

        const finalScale = this.el.object3D.scale.clone();
        const scaleChange = this.initialScale ? finalScale.clone().divide(this.initialScale) : new THREE.Vector3(1, 1, 1);

        this.el.removeState('stretched');

        console.log(`[stretchable] 🔚 STRETCH FINALIZADO. Escala final: (${finalScale.x.toFixed(2)}, ${finalScale.y.toFixed(2)}, ${finalScale.z.toFixed(2)})`);
        this.el.emit('stretch-end', {
            finalScale: finalScale,
            scaleChange: scaleChange,
            gesture: this.data.endGesture
        }, false);

        this.initialScale = null;
    }
});