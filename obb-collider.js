/**
 * Componente: obb-collider
 * Colisionador OBB que usa el sistema de colisiones nativo de A-Frame.
 * Emite eventos: obbcollisionstarted, obbcollisionended
 * Compatible con geometry existente o crea una invisible.
 */
AFRAME.registerComponent('obb-collider', {
    schema: {
        size: { type: 'vec3', default: { x: 0.3, y: 0.3, z: 0.3 } },
        trackedObject3D: { type: 'string', default: 'mesh' },
        debug: { type: 'boolean', default: false }
    },

    init: function () {
        this.colliding = new Set(); // IDs de entidades con las que está colisionando

        // Estructura OBB para compatibilidad con sat-collider
        this.obb = {
            center: new THREE.Vector3(),
            size: new THREE.Vector3(
                this.data.size.x,
                this.data.size.y,
                this.data.size.z
            ),
            halfSize: new THREE.Vector3(
                this.data.size.x / 2,
                this.data.size.y / 2,
                this.data.size.z / 2
            ),
            quaternion: new THREE.Quaternion(),
            matrix: new THREE.Matrix4()
        };

        // Asegurar que hay geometría
        this._ensureGeometry();

        // Debug box si está activado
        if (this.data.debug) {
            this._createDebugBox();
        }

        console.log(`[obb-collider] ✅ Inicializado en ${this.el.id || 'sin-id'} con tamaño:`, this.data.size);
    },

    _ensureGeometry: function () {
        const geometry = this.el.getAttribute('geometry');

        if (!geometry) {
            // Si no hay geometría, crear una invisible
            this.el.setAttribute('geometry', {
                primitive: 'box',
                width: this.data.size.x,
                height: this.data.size.y,
                depth: this.data.size.z
            });

            // Hacer invisible
            this.el.setAttribute('material', {
                visible: false,
                transparent: true,
                opacity: 0
            });

            console.log(`[obb-collider] Creada geometría invisible para ${this.el.id || 'sin-id'}`);
        } else {
            // Si ya hay geometría, actualizar tamaño del OBB
            if (geometry.primitive === 'box') {
                this.obb.size.set(
                    geometry.width || 1,
                    geometry.height || 1,
                    geometry.depth || 1
                );
                this.obb.halfSize.set(
                    this.obb.size.x / 2,
                    this.obb.size.y / 2,
                    this.obb.size.z / 2
                );
            }
        }
    },

    _createDebugBox: function () {
        this._debugBox = document.createElement('a-box');
        this._debugBox.setAttribute('width', this.data.size.x);
        this._debugBox.setAttribute('height', this.data.size.y);
        this._debugBox.setAttribute('depth', this.data.size.z);
        this._debugBox.setAttribute('color', '#00f');
        this._debugBox.setAttribute('opacity', 0.25);
        this._debugBox.setAttribute('wireframe', true);
        this._debugBox.setAttribute('material', 'transparent: true');
        this.el.appendChild(this._debugBox);
    },

    remove: function () {
        if (this._debugBox) this._debugBox.remove();
        this.colliding.clear();
    },

    tick: function () {
        // Actualizar OBB con posición/rotación mundial
        this.el.object3D.getWorldPosition(this.obb.center);
        this.el.object3D.getWorldQuaternion(this.obb.quaternion);
        this.obb.matrix.compose(this.obb.center, this.obb.quaternion, new THREE.Vector3(1, 1, 1));

        // Detectar colisiones con otros obb-colliders
        this._checkCollisions();

        // Debug visual
        if (this._debugBox) {
            this._debugBox.object3D.position.set(0, 0, 0);
            this._debugBox.object3D.quaternion.set(0, 0, 0, 1);
        }
    },

    _checkCollisions: function () {
        const sceneEl = this.el.sceneEl;
        if (!sceneEl) return;

        // Obtener todas las entidades con obb-collider
        const allColliders = sceneEl.querySelectorAll('[obb-collider]');

        const currentColliding = new Set();

        for (const otherEl of allColliders) {
            // No colisionar consigo mismo
            if (otherEl === this.el) continue;

            const otherCollider = otherEl.components['obb-collider'];
            if (!otherCollider) continue;

            // Test de colisión OBB simplificado
            const isColliding = this._testOBBCollision(this.obb, otherCollider.obb);

            if (isColliding) {
                const otherId = otherEl.id || otherEl.getAttribute('id') || 'sin-id';
                currentColliding.add(otherId);

                // Si es una colisión nueva, emitir evento
                if (!this.colliding.has(otherId)) {
                    this._emitCollisionStart(otherEl);
                }
            }
        }

        // Detectar colisiones que terminaron
        for (const prevId of this.colliding) {
            if (!currentColliding.has(prevId)) {
                const otherEl = document.getElementById(prevId) ||
                    sceneEl.querySelector(`[obb-collider][id="${prevId}"]`);
                if (otherEl) {
                    this._emitCollisionEnd(otherEl);
                }
            }
        }

        this.colliding = currentColliding;
    },

    _testOBBCollision: function (obb1, obb2) {
        // Test OBB simplificado: distancia entre centros vs suma de halfSize
        const distance = obb1.center.distanceTo(obb2.center);
        const maxDist = (obb1.halfSize.length() + obb2.halfSize.length());
        return distance < maxDist;
    },

    _emitCollisionStart: function (otherEl) {
        this.el.emit('obbcollisionstarted', { withEl: otherEl }, false);

        if (this.data.debug) {
            console.log(`[obb-collider] 🟢 COLISIÓN INICIADA: ${this.el.id || 'sin-id'} <-> ${otherEl.id || 'sin-id'}`);
        }
    },

    _emitCollisionEnd: function (otherEl) {
        this.el.emit('obbcollisionended', { withEl: otherEl }, false);

        if (this.data.debug) {
            console.log(`[obb-collider] 🔴 COLISIÓN TERMINADA: ${this.el.id || 'sin-id'} <-> ${otherEl.id || 'sin-id'}`);
        }
    },

    // ✅ API compatible con sat-collider
    getOBB: function () {
        return this.obb;
    },

    testCollision: function (otherOBB) {
        return this._testOBBCollision(this.obb, otherOBB);
    },

    // ✅ Método para actualizar tamaño dinámicamente (útil para stretchable)
    updateSize: function (newSize) {
        this.obb.size.copy(newSize);
        this.obb.halfSize.set(
            newSize.x / 2,
            newSize.y / 2,
            newSize.z / 2
        );

        // Actualizar geometría si existe
        const geometry = this.el.getAttribute('geometry');
        if (geometry && geometry.primitive === 'box') {
            this.el.setAttribute('geometry', {
                width: newSize.x,
                height: newSize.y,
                depth: newSize.z
            });
        }

        // Actualizar debug box
        if (this._debugBox) {
            this._debugBox.setAttribute('width', newSize.x);
            this._debugBox.setAttribute('height', newSize.y);
            this._debugBox.setAttribute('depth', newSize.z);
        }
    }
});