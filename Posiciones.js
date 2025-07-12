AFRAME.registerComponent('hand-tracker', {
    tick: function () {
        const session = this.el.sceneEl.renderer.xr.getSession();
        if (!session) return;

        const frame = this.el.sceneEl.frame;
        const referenceSpace = this.el.sceneEl.renderer.xr.getReferenceSpace();
        
        if (!frame || !referenceSpace) return;

        
        for (const inputSource of session.inputSources) {
            if (inputSource.hand) {
                this.logHandData(inputSource, frame, referenceSpace);
            }
        }
    },

    logHandData: function (inputSource, frame, referenceSpace) {
        console.log(`\n=== MANO ${inputSource.handedness.toUpperCase()} ===`);
        
        // Iterar sobre todas las articulaciones disponibles
        for (const [jointName, joint] of inputSource.hand) {
            const jointPose = frame.getJointPose(joint, referenceSpace);
            
            if (jointPose) {
                const pos = jointPose.transform.position;
                console.log(`${jointName}: X=${pos.x.toFixed(3)}, Y=${pos.y.toFixed(3)}, Z=${pos.z.toFixed(3)}`);
            }
        }
    }
});