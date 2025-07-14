AFRAME.registerComponent('hand-tracker', {
    init: function () {
        console.log("🚀 Hand tracker iniciado");
        this.infoText = document.querySelector('#handInfo');
        this.lastUpdate = 0;
        this.updateInterval = 200; // Actualizar cada 200ms
        this.stepCounter = 0;
    },

    tick: function () {
        const currentTime = Date.now();
        if (currentTime - this.lastUpdate < this.updateInterval) return;
        
        this.lastUpdate = currentTime;
        this.stepCounter++;
        
        // VERIFICAR ESTADO PASO A PASO
        let displayText = "=== DETECTOR DE MANOS WebXR ===\n\n";
        
        // PASO 1: Verificar si estamos en VR
        const renderer = this.el.sceneEl.renderer;
        if (!renderer.xr.isPresenting) {
            displayText += "❌ PASO 1: NO estás en modo VR\n";
            displayText += "💡 Presiona el botón 'Enter VR'\n";
            displayText += `⏱️ Tiempo: ${new Date().toLocaleTimeString()}\n`;
            this.updateDisplay(displayText);
            return;
        }
        
        displayText += "✅ PASO 1: En modo VR\n";
        
        // PASO 2: Verificar sesión WebXR
        const session = renderer.xr.getSession();
        if (!session) {
            displayText += "❌ PASO 2: Sin sesión WebXR\n";
            this.updateDisplay(displayText);
            return;
        }
        
        displayText += "✅ PASO 2: Sesión WebXR activa\n";
        
        // PASO 3: Verificar frame y referenceSpace
        const frame = this.el.sceneEl.frame;
        const referenceSpace = renderer.xr.getReferenceSpace();
        
        if (!frame || !referenceSpace) {
            displayText += "❌ PASO 3: Sin frame/referenceSpace\n";
            this.updateDisplay(displayText);
            return;
        }
        
        displayText += "✅ PASO 3: Frame y referenceSpace OK\n";
        
        // PASO 4: Verificar input sources
        const inputSources = session.inputSources;
        displayText += `📱 Input sources: ${inputSources.length}\n\n`;
        
        if (inputSources.length === 0) {
            displayText += "⚠️ PASO 4: Sin input sources\n";
            displayText += "💡 Mueve las manos frente a las cámaras\n";
            this.updateDisplay(displayText);
            return;
        }
        
        // PASO 5: Analizar cada input source
        let handsDetected = 0;
        
        for (let i = 0; i < inputSources.length; i++) {
            const inputSource = inputSources[i];
            
            displayText += `🎮 Input ${i + 1}:\n`;
            displayText += `   Lado: ${inputSource.handedness}\n`;
            displayText += `   Tipo: ${inputSource.targetRayMode}\n`;
            displayText += `   Mano: ${inputSource.hand ? '✅ SÍ' : '❌ NO'}\n`;
            
            if (inputSource.hand) {
                handsDetected++;
                displayText += this.getHandPositions(inputSource, frame, referenceSpace);
            }
            
            displayText += "\n";
        }
        
        // RESUMEN
        displayText += `🖐️ MANOS DETECTADAS: ${handsDetected}\n`;
        displayText += `🔄 Updates: ${this.stepCounter}\n`;
        displayText += `⏱️ ${new Date().toLocaleTimeString()}\n`;
        
        if (handsDetected === 0) {
            displayText += "\n💡 CONSEJOS:\n";
            displayText += "• Activa Hand Tracking en Quest\n";
            displayText += "• Mejora la iluminación\n";
            displayText += "• Manos visibles a las cámaras\n";
        }
        
        this.updateDisplay(displayText);
    },

    getHandPositions: function (inputSource, frame, referenceSpace) {
        let handText = `   🖐️ POSICIONES MANO ${inputSource.handedness.toUpperCase()}:\n`;
        
        // Articulaciones principales para mostrar
        const mainJoints = [
            'wrist',
            'thumb-tip', 
            'index-finger-tip', 
            'middle-finger-tip', 
            'ring-finger-tip', 
            'pinky-finger-tip'
        ];
        
        const jointLabels = [
            'Muñeca',
            'Pulgar',
            'Índice', 
            'Medio', 
            'Anular', 
            'Meñique'
        ];
        
        for (let i = 0; i < mainJoints.length; i++) {
            const jointName = mainJoints[i];
            const label = jointLabels[i];
            const joint = inputSource.hand.get(jointName);
            
            if (joint) {
                const jointPose = frame.getJointPose(joint, referenceSpace);
                if (jointPose) {
                    const pos = jointPose.transform.position;
                    handText += `   ${label}: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})\n`;
                } else {
                    handText += `   ${label}: Sin pose\n`;
                }
            } else {
                handText += `   ${label}: No encontrado\n`;
            }
        }
        
        return handText;
    },

    updateDisplay: function(text) {
        if (this.infoText) {
            this.infoText.setAttribute('value', text);
        }
        // También en consola para debug remoto
        console.log(text);
    }
});