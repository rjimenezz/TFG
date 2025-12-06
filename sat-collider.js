/**
 * Componente: sat-collider
 * Colisionador OBB con detección SAT (Separating Axis Theorem) de 15 ejes.
 */
AFRAME.registerComponent('sat-collider', {
  schema: {
    size: { type: 'vec3', default: { x: 0.3, y: 0.3, z: 0.3 } },
    debug: { type: 'boolean', default: false }
  },

  init: function () {
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

    if (this.data.debug) {
      this._debugBox = document.createElement('a-box');
      this._debugBox.setAttribute('width', this.data.size.x);
      this._debugBox.setAttribute('height', this.data.size.y);
      this._debugBox.setAttribute('depth', this.data.size.z);
      this._debugBox.setAttribute('color', '#0f0');
      this._debugBox.setAttribute('opacity', 0.25);
      this._debugBox.setAttribute('wireframe', true);
      this.el.appendChild(this._debugBox);
    }
  },

  remove: function () {
    if (this._debugBox) this._debugBox.remove();
  },

  tick: function () {
    this.el.object3D.getWorldPosition(this.obb.center);
    this.el.object3D.getWorldQuaternion(this.obb.quaternion);
    this.obb.matrix.compose(this.obb.center, this.obb.quaternion, new THREE.Vector3(1, 1, 1));

    if (this._debugBox) {
      this._debugBox.object3D.position.set(0, 0, 0);
      this._debugBox.object3D.quaternion.set(0, 0, 0, 1);
    }
  },

  getOBB: function () {
    return this.obb;
  },

  testCollision: function (otherOBB) {
    return this._testSATCollision(this.obb, otherOBB);
  },

  _testSATCollision: function (obb1, obb2) {
    const axes1 = this._getOBBAxes(obb1.quaternion);
    const axes2 = this._getOBBAxes(obb2.quaternion);
    const T = new THREE.Vector3().subVectors(obb2.center, obb1.center);

    const testAxes = [
      ...axes1,
      ...axes2,
      ...this._getCrossAxes(axes1, axes2)
    ];

    for (const axis of testAxes) {
      if (axis.lengthSq() < 1e-6) continue;

      const L = axis.clone().normalize();
      const r1 = this._projectOBBRadius(obb1, axes1, L);
      const r2 = this._projectOBBRadius(obb2, axes2, L);
      const distance = Math.abs(T.dot(L));

      if (distance > r1 + r2) {
        return false;
      }
    }

    return true;
  },

  _getOBBAxes: function (quaternion) {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    return [
      new THREE.Vector3(m.elements[0], m.elements[1], m.elements[2]),
      new THREE.Vector3(m.elements[4], m.elements[5], m.elements[6]),
      new THREE.Vector3(m.elements[8], m.elements[9], m.elements[10])
    ];
  },

  _getCrossAxes: function (axes1, axes2) {
    const crosses = [];
    for (const a1 of axes1) {
      for (const a2 of axes2) {
        crosses.push(new THREE.Vector3().crossVectors(a1, a2));
      }
    }
    return crosses;
  },

  _projectOBBRadius: function (obb, axes, L) {
    return Math.abs(obb.halfSize.x * axes[0].dot(L)) +
           Math.abs(obb.halfSize.y * axes[1].dot(L)) +
           Math.abs(obb.halfSize.z * axes[2].dot(L));
  }
});