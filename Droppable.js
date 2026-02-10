/**
 * Componente: droppable
 * Configura una entidad como objetivo para recibir entidades draggable.
 * Adaptado para hand-tracking.
 * 
 * Estados:
 * - 'dragover': Añadido mientras un draggable aceptable está sobre el droppable
 * 
 * Eventos:
 * - 'drag-drop': { dropped, hand } - Drag-drop exitoso
 * - Custom: acceptEvent, rejectEvent con detalles personalizados
 */
AFRAME.registerComponent('droppable', {
    schema: {
        accepts: { type: 'string', default: '' },
        autoUpdate: { type: 'boolean', default: true },
        acceptEvent: { type: 'string', default: '' },
        rejectEvent: { type: 'string', default: '' },
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
        this.detectors = this._findDetectors();

        if (this.detectors.length === 0) {
            console.warn('[droppable] No se encontraron detectores de gestos.');
            return;
        }

        this.colliderType = this._detectColliderType();

        this.acceptedEntities = [];
        this.collidingDraggables = new Set();
        this.dragOverActive = false;

        this._ensureCollider();

        if (this.colliderType === 'obb-collider') {
            this._onOBBCollisionStart = this._onOBBCollisionStart.bind(this);
            this._onOBBCollisionEnd = this._onOBBCollisionEnd.bind(this);

            this.el.addEventListener('obbcollisionstarted', this._onOBBCollisionStart);
            this.el.addEventListener('obbcollisionended', this._onOBBCollisionEnd);
        }

        if (this.data.autoUpdate) {
            this._setupMutationObserver();
        }

        console.log(`[droppable] ✅ Inicializado en ${this.el.id || this.el.tagName}`);
        console.log(`  - Accepts: ${this.data.accepts || 'all'}`);
        console.log(`  - Colisionador: ${this.colliderType}`);
    },

    _findDetectors: function () {
        const detectors = [];
        const entities = this.sceneEl.querySelectorAll('a-entity');

        for (let entity of entities) {
            if (entity.components['gesto-pellizco'] || entity.components['gesto-apuntar']) {
                detectors.push(entity);
            }
        }

        return detectors;
    },

    _detectColliderType: function () {
        for (let detector of this.detectors) {
            const gestoComp = detector.components['gesto-pellizco'] ||
                detector.components['gesto-apuntar'];

            if (gestoComp?.data.colliderType) {
                return gestoComp.data.colliderType;
            }
        }
        return 'sat-collider';
    },

    _setupMutationObserver: function () {
        const observer = new MutationObserver(() => {
            this._updateAcceptedEntities();
        });

        observer.observe(this.sceneEl, {
            childList: true,
            subtree: true
        });

        this.mutationObserver = observer;
    },

    _updateAcceptedEntities: function () {
        if (!this.data.accepts) {
            this.acceptedEntities = [];
            return;
        }

        try {
            this.acceptedEntities = Array.from(
                this.sceneEl.querySelectorAll(this.data.accepts)
            );

            if (this.data.debug) {
                console.log(`[droppable] 🔄 Actualizado - ${this.acceptedEntities.length} entidades aceptadas`);
            }
        } catch (e) {
            console.warn(`[droppable] Selector CSS inválido: ${this.data.accepts}`, e);
            this.acceptedEntities = [];
        }
    },

    remove: function () {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }

        if (this.colliderType === 'obb-collider') {
            this.el.removeEventListener('obbcollisionstarted', this._onOBBCollisionStart);
            this.el.removeEventListener('obbcollisionended', this._onOBBCollisionEnd);
        }

        // Limpiar todos los listeners
        this.collidingDraggables.forEach(draggableEl => {
            this._cleanupListener(draggableEl);
        });

        if (this.el.is('dragover')) {
            this.el.removeState('dragover');
        }

        this.el.removeAttribute(this.colliderType);
    },

    _ensureCollider: function () {
        const hasCollider = this.el.components['sat-collider'] || this.el.components['obb-collider'];

        if (!hasCollider) {
            let size = { x: 0.5, y: 0.5, z: 0.5 };

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
            } else if (geometry?.primitive === 'plane') {
                size = {
                    x: geometry.width || 1,
                    y: 0.1,
                    z: geometry.height || 1
                };
            }

            console.log(`[droppable] ➕ Añadiendo ${this.colliderType} con tamaño:`, size);

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
                            color: '#0ff',
                            opacity: 0.2,
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
            console.log(`[droppable] ✓ Ya tiene colisionador: ${hasCollider.name}`);
        }
    },

    _onOBBCollisionStart: function (e) {
        const collidedWith = e.detail.withEl;
        this._handleCollisionStart(collidedWith);
    },

    _onOBBCollisionEnd: function (e) {
        const collidedWith = e.detail.withEl;
        this._handleCollisionEnd(collidedWith);
    },

    tick: function () {
        if (this.detectors.length === 0) return;

        if (this.colliderType === 'sat-collider') {
            const droppableCollider = this.el.components['sat-collider'];
            if (!droppableCollider) return;

            const droppableOBB = droppableCollider.getOBB();
            const draggables = this.sceneEl.querySelectorAll('[draggable]');

            draggables.forEach(draggableEl => {
                if (draggableEl === this.el) return;

                const draggableCollider = draggableEl.components['sat-collider'];
                if (!draggableCollider) return;

                const draggableOBB = draggableCollider.getOBB();
                const isColliding = this._testSATCollision(droppableOBB, draggableOBB);

                if (isColliding && !this.collidingDraggables.has(draggableEl)) {
                    this._handleCollisionStart(draggableEl);
                } else if (!isColliding && this.collidingDraggables.has(draggableEl)) {
                    this._handleCollisionEnd(draggableEl);
                }
            });
        }

        this._updateDragOverState();
    },

    _testSATCollision: function (obb1, obb2) {
        const distance = obb1.center.distanceTo(obb2.center);
        const maxDist = (obb1.halfSize.length() + obb2.halfSize.length());
        return distance < maxDist;
    },

    _handleCollisionStart: function (collidedWith) {
        if (!collidedWith.components || !collidedWith.components['draggable']) {
            return;
        }

        this.collidingDraggables.add(collidedWith);

        if (this.data.debug) {
            console.log(`[droppable] 🟢 Colisión con draggable: ${collidedWith.id || collidedWith.tagName}`);
        }

        // Inicializar Map si no existe
        if (!collidedWith._droppableListeners) {
            collidedWith._droppableListeners = new Map();
        }

        // Limpiar listener previo de este droppable específico
        if (collidedWith._droppableListeners.has(this.el.id)) {
            const oldListener = collidedWith._droppableListeners.get(this.el.id);
            collidedWith.removeEventListener('drag-end', oldListener);
            collidedWith._droppableListeners.delete(this.el.id);
        }

        // Añadir nuevo listener
        const onDragEnd = (e) => {
            this._handleDrop(collidedWith, e.detail.hand);
            this._cleanupListener(collidedWith);
        };

        collidedWith.addEventListener('drag-end', onDragEnd);
        collidedWith._droppableListeners.set(this.el.id, onDragEnd);
    },

    _handleCollisionEnd: function (collidedWith) {
        if (!collidedWith.components || !collidedWith.components['draggable']) {
            return;
        }

        this.collidingDraggables.delete(collidedWith);

        if (this.data.debug) {
            console.log(`[droppable] 🔴 Fin colisión con draggable: ${collidedWith.id || collidedWith.tagName}`);
        }

        this._cleanupListener(collidedWith);
    },

    _cleanupListener: function (draggableEl) {
        if (!draggableEl._droppableListeners) return;

        const listener = draggableEl._droppableListeners.get(this.el.id);
        if (listener) {
            draggableEl.removeEventListener('drag-end', listener);
            draggableEl._droppableListeners.delete(this.el.id);
        }
    },

    _updateDragOverState: function () {
        const hasAcceptedDraggable = Array.from(this.collidingDraggables).some(el => {
            return el.is('dragged') && this._isAccepted(el);
        });

        if (hasAcceptedDraggable && !this.dragOverActive) {
            this.el.addState('dragover');
            this.dragOverActive = true;

            if (this.data.debug) {
                console.log('[droppable] ✨ Estado DRAGOVER activado');
            }
        } else if (!hasAcceptedDraggable && this.dragOverActive) {
            this.el.removeState('dragover');
            this.dragOverActive = false;

            if (this.data.debug) {
                console.log('[droppable] 💨 Estado DRAGOVER desactivado');
            }
        }
    },

    _handleDrop: function (draggableEl, hand) {
        if (!this.collidingDraggables.has(draggableEl)) {
            return;
        }

        const accepted = this._isAccepted(draggableEl);

        if (accepted) {
            console.log(`[droppable] ✅ DROP ACEPTADO - ${draggableEl.id || draggableEl.tagName}`);

            this.el.emit('drag-drop', {
                dropped: draggableEl,
                hand: hand
            }, false);

            if (this.data.acceptEvent) {
                this.el.emit(this.data.acceptEvent, {
                    el: draggableEl,
                    hand: hand
                }, false);
            }
        } else {
            console.log(`[droppable] ❌ DROP RECHAZADO - ${draggableEl.id || draggableEl.tagName}`);

            if (this.data.rejectEvent) {
                this.el.emit(this.data.rejectEvent, {
                    el: draggableEl,
                    hand: hand
                }, false);
            }
        }
    },

    _isAccepted: function (entity) {
        if (!this.data.accepts) {
            return true;
        }

        if (this.data.autoUpdate && this.acceptedEntities.length === 0) {
            this._updateAcceptedEntities();
        }

        return this.acceptedEntities.includes(entity);
    }
});