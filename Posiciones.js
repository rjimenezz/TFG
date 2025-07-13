AFRAME.registerComponent('hand-tracker', {
    init: function () {
        this.infoText = document.querySelector('#handInfo');
        this.lastUpdate = 0;
        this.updateInterval = 100; // Actualizar cada 100ms
    },

    tick: function () {
        const currentTime = Date.now();
        if (currentTime - this.lastUpdate < this.updateInterval) return;
        
        const session = this.el.sceneEl.renderer.xr.getSession();
        if (!session) return;

        const frame = this.el.sceneEl.frame;
        const referenceSpace = this.el.sceneEl.renderer.xr.getReferenceSpace();
        
        if (!frame || !referenceSpace) return;

        let displayText = "=== POSICIONES DE MANOS ===\n\n";

        // Obtener datos de ambas manos
        for (const inputSource of session.inputSources) {
            if (inputSource.hand) {
                displayText += this.getHandDataText(inputSource, frame, referenceSpace);
            }
        }

        // Actualizar texto en pantalla
        this.infoText.setAttribute('value', displayText);
        this.lastUpdate = currentTime;

        // También en consola (para remote debugging)
        console.clear();
        console.log(displayText);
    },

    getHandDataText: function (inputSource, frame, referenceSpace) {
        let handText = `MANO ${inputSource.handedness.toUpperCase()}:\n`;
        
        // Solo mostrar articulaciones principales para no saturar
        const mainJoints = ['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
        
        for (const [jointName, joint] of inputSource.hand) {
            if (mainJoints.includes(jointName)) {
                const jointPose = frame.getJointPose(joint, referenceSpace);
                
                if (jointPose) {
                    const pos = jointPose.transform.position;
                    handText += `${jointName}: X=${pos.x.toFixed(2)}, Y=${pos.y.toFixed(2)}, Z=${pos.z.toFixed(2)}\n`;
                }
            }
        }
        
        return handText + "\n";
    }
});