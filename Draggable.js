/**
 * Componente: draggable
 * Permite que un objeto participe en gestos de arrastrar y soltar con entidades droppable.
 * Adaptado para hand-tracking: usa gestos de pellizco/apuntar en lugar de botones.
 * 
 * Estados:
 * - 'dragged': Añadido desde el inicio del gesto hasta el final
 * 
 * Eventos:
 * - 'drag-start': { hand } - Inicia arrastre
 * - 'drag-end': { hand } - Termina arrastre
 */
AFRAME.registerComponent('draggable', {
    schema: {
        startGesture: { type: 'string', default: 'pinchstart' },
        endGesture: { type: 'string', default: 'pinchend' },
        debug: { type: 'boolean', default: false }
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
            console.warn('[draggable] No se encontró detector compatible.');
            return;
        }

        this.colliderType = this._detectColliderType();

        this.dragging = false;
        this.dragHand = null;
        this.inContact = { left: false, right: false };
        this.isGesturing = { left: false, right: false };

        this._ensureCollider();

        // Event listeners para colisiones
        if (this.colliderType === 'obb-collider') {
            this._onOBBCollisionStart = this._onOBBCollisionStart.bind(this);
            this._onOBBCollisionEnd = this._onOBBCollisionEnd.bind(this);

            this.el.addEventListener('obbcollisionstarted', this._onOBBCollisionStart);
            this.el.addEventListener('obbcollisionended', this._onOBBCollisionEnd);
        }

        // Event listeners para gestos
        this._onGestureStart = this._onGestureStart.bind(this);
        this._onGestureEnd = this._onGestureEnd.bind(this);

        this.detector.addEventListener(this.data.startGesture, this._onGestureStart);
        this.detector.addEventListener(this.data.endGesture, this._onGestureEnd);

        console.log(`[draggable] ✅ Inicializado en ${this.el.id || this.el.tagName}`);
        console.log(`  - Detector: ${this.detector.id || 'sin-id'}`);
        console.log(`  - Colisionador: ${this.colliderType}`);
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
        console.log(`[draggable] 🔍 Colisionador detectado: ${detectedType}`);
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

        if (this.el.is('dragged')) {
            this.el.removeState('dragged');
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

            console.log(`[draggable] ➕ Añadiendo ${this.colliderType} con tamaño:`, size);

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
                            color: '#f0f',
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
            console.log(`[draggable] ✓ Ya tiene colisionador: ${hasCollider.name}`);
        }
    },

    _onOBBCollisionStart: function (e) {
        const collidedWith = e.detail.withEl;
        if (collidedWith?.id.startsWith('hand-collider-') || collidedWith?.id.startsWith('hand-point-collider-')) {
            const hand = collidedWith.id.includes('left') ? 'left' : 'right';
            this.inContact[hand] = true;

            if (this.data.debug) {
                console.log(`[draggable] 🟢 Contacto con mano ${hand}`);
            }
        }
    },

    _onOBBCollisionEnd: function (e) {
        const collidedWith = e.detail.withEl;
        if (collidedWith?.id.startsWith('hand-collider-') || collidedWith?.id.startsWith('hand-point-collider-')) {
            const hand = collidedWith.id.includes('left') ? 'left' : 'right';
            this.inContact[hand] = false;

            if (this.data.debug) {
                console.log(`[draggable] 🔴 Sin contacto con mano ${hand}`);
            }
        }
    },

    tick: function () {
        if (!this.detector) return;

        const gestoComp = this.detector.components['gesto-pellizco'] ||
            this.detector.components['gesto-apuntar'];

        if (!gestoComp?.getHandCollider) return;

        // Detección manual para SAT-collider
        if (this.colliderType === 'sat-collider') {
            const objectCollider = this.el.components['sat-collider'];
            if (!objectCollider) return;

            ['left', 'right'].forEach(h => {
                const handCollider = gestoComp.getHandCollider(h);

                if (handCollider) {
                    const wasInContact = this.inContact[h];
                    const objectOBB = objectCollider.getOBB();
                    this.inContact[h] = handCollider.testCollision(objectOBB);

                    if (this.data.debug && this.inContact[h] && !wasInContact) {
                        console.log(`[draggable] 🟢 Contacto con mano ${h} (SAT)`);
                    } else if (this.data.debug && !this.inContact[h] && wasInContact) {
                        console.log(`[draggable] 🔴 Sin contacto con mano ${h} (SAT)`);
                    }
                } else {
                    this.inContact[h] = false;
                }
            });
        }
    },

    _onGestureStart: function (e) {
        const hand = e.detail?.hand;
        if (!hand) return;

        this.isGesturing[hand] = true;

        // Iniciar drag si hay contacto
        if (this.inContact[hand] && !this.dragging) {
            this._startDrag(hand);
        }
    },

    _onGestureEnd: function (e) {
        const hand = e.detail?.hand;
        if (!hand) return;

        this.isGesturing[hand] = false;

        // Terminar drag si es la mano que está arrastrando
        if (this.dragging && this.dragHand === hand) {
            this._endDrag(hand);
        }
    },

    _startDrag: function (hand) {
        this.dragging = true;
        this.dragHand = hand;
        this.el.addState('dragged');

        console.log(`[draggable] 🎯 DRAG START - Mano ${hand}`);
        this.el.emit('drag-start', { hand }, false);
    },

    _endDrag: function (hand) {
        this.dragging = false;
        this.dragHand = null;
        this.el.removeState('dragged');

        console.log(`[draggable] 🔓 DRAG END - Mano ${hand}`);
        this.el.emit('drag-end', { hand }, false);
    }
});