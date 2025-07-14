// Componente para detectar manos
AFRAME.registerComponent('hand-tracker', {
    
    init: function () {
        console.log("Sistema iniciado");
        
        // Encontrar donde vamos a escribir en pantalla
        this.pantalla = document.querySelector('#handInfo');
        
        // Variables de tiempo
        this.ultimoTiempo = 0;
        this.intervalo = 500; // Actualizar cada medio segundo
    },

    tick: function () {
        // Controlar tiempo para no ir muy rápido
        const ahora = Date.now();
        if (ahora - this.ultimoTiempo < this.intervalo) {
            return;
        }
        this.ultimoTiempo = ahora;
        
        // Obtener las herramientas de WebXR
        const renderer = this.el.sceneEl.renderer;
        const session = renderer.xr.getSession();
        const frame = this.el.sceneEl.frame;
        const referenceSpace = renderer.xr.getReferenceSpace();
        
        // Obtener las manos
        const inputSources = session.inputSources;
        
        // Crear texto para la pantalla
        let textoPantalla = "=== MANOS ===\n\n";
        
        // Revisar cada dispositivo
        for (let i = 0; i < inputSources.length; i++) {
            const dispositivo = inputSources[i];
            
            // Si es una mano
            if (dispositivo.hand) {
                // PANTALLA: Solo lo básico
                textoPantalla = textoPantalla + this.obtenerDatosBasicos(dispositivo, frame, referenceSpace);
                
                // CONSOLA: Todo completo
                this.mostrarTodoEnConsola(dispositivo, frame, referenceSpace);
            }
        }
        
        // Mostrar en pantalla
        this.pantalla.setAttribute('value', textoPantalla);
    },

    // Función para obtener solo 6 puntos principales
    obtenerDatosBasicos: function (dispositivo, frame, referenceSpace) {
        let texto = "MANO " + dispositivo.handedness.toUpperCase() + ":\n";
        
        // Lista simple de lo que queremos mostrar
        const puntos = [
            'wrist',
            'thumb-tip',
            'index-finger-tip',
            'middle-finger-tip',
            'ring-finger-tip',
            'pinky-finger-tip'
        ];
        
        const nombres = [
            'Muñeca',
            'Pulgar',
            'Indice',
            'Medio',
            'Anular',
            'Meñique'
        ];
        
        // Revisar cada punto
        for (let i = 0; i < puntos.length; i++) {
            const joint = dispositivo.hand.get(puntos[i]);
            const pose = frame.getJointPose(joint, referenceSpace);
            
            if (pose) {
                const x = pose.transform.position.x.toFixed(2);
                const y = pose.transform.position.y.toFixed(2);
                const z = pose.transform.position.z.toFixed(2);
                
                texto = texto + "  " + nombres[i] + ": (" + x + ", " + y + ", " + z + ")\n";
            } else {
                texto = texto + "  " + nombres[i] + ": Sin datos\n";
            }
        }
        
        return texto + "\n";
    },

    // Función para mostrar todo en consola
    mostrarTodoEnConsola: function (dispositivo, frame, referenceSpace) {
        console.log("========== MANO " + dispositivo.handedness.toUpperCase() + " ==========");
        
        let total = 0;
        let conDatos = 0;
        
        // Revisar TODAS las articulaciones
        for (const [nombre, joint] of dispositivo.hand) {
            total = total + 1;
            
            const pose = frame.getJointPose(joint, referenceSpace);
            
            if (pose) {
                conDatos = conDatos + 1;
                
                const x = pose.transform.position.x.toFixed(4);
                const y = pose.transform.position.y.toFixed(4);
                const z = pose.transform.position.z.toFixed(4);
                const radio = pose.radius.toFixed(4);
                
                console.log(nombre + " | X: " + x + " | Y: " + y + " | Z: " + z + " | Radio: " + radio);
            } else {
                console.log(nombre + " | SIN DATOS");
            }
        }
        
        console.log("Total articulaciones: " + total);
        console.log("Con datos: " + conDatos);
        console.log("----------------------------------------");
    }
});