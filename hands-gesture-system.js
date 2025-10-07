AFRAME.registerSystem('hand-gestures-system', {
  init: function () {
    this.renderer = null;
    this.refSpace = null;
    this.hands = {
      left:  { joints: new Map(), pinch: { active:false, distance:null } },
      right: { joints: new Map(), pinch: { active:false, distance:null } }
    };
    this._tmp = { thumb:null, index:null };
    this.cfg = { pinchStart:0.025, pinchEnd:0.035 };
  },

  tick: function () {
    const scene = this.sceneEl;
    if (!scene || !scene.renderer) return;
    if (!this.renderer) this.renderer = scene.renderer;
    const session = this.renderer.xr.getSession();
    if (!session) return;
    const frame = scene.frame;
    if (!frame) return;
    if (!this.refSpace) {
      this.refSpace = this.renderer.xr.getReferenceSpace();
      if (!this.refSpace) return;
    }

    for (const inputSource of session.inputSources) {
      if (!inputSource.hand) continue;
      const h = inputSource.handedness; // 'left' | 'right'
      const store = this.hands[h];
      // Actualizar joints
      for (const jointName of inputSource.hand.keys()) {
        const joint = inputSource.hand.get(jointName);
        const pose = frame.getJointPose(joint, this.refSpace);
        if (pose) store.joints.set(jointName, pose);
      }
      // Pinch detection
      const thumbPose = store.joints.get('thumb-tip');
      const indexPose = store.joints.get('index-finger-tip');
      if (thumbPose && indexPose) {
        const dx = thumbPose.transform.position.x - indexPose.transform.position.x;
        const dy = thumbPose.transform.position.y - indexPose.transform.position.y;
        const dz = thumbPose.transform.position.z - indexPose.transform.position.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const was = store.pinch.active;
        store.pinch.distance = dist;
        if (!was && dist <= this.cfg.pinchStart) {
            store.pinch.active = true;
            scene.emit('hg-pinchstart', { hand:h, distance:dist }, false);
        } else if (was && dist >= this.cfg.pinchEnd) {
            store.pinch.active = false;
            scene.emit('hg-pinchend', { hand:h, distance:dist }, false);
        } else if (store.pinch.active) {
            scene.emit('hg-pinchmove', { hand:h, distance:dist }, false);
        }
      }
    }
  },

  getHand: function (handedness) {
    return this.hands[handedness] || null;
  }
});