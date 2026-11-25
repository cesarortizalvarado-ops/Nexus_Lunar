# Nexus Lunar — Especificación Maestra de Arquitectura y Dominio

## 1. Visión y Principios
- **Propósito:** Asistente personal local-first para planificación semanal integral (hábitos, finanzas, nutrición/ejercicio, agenda y proyectos) que reduce la carga mental sin exigir gestión manual constante.
- **Determinismo primero:** Las reglas de negocio, cálculos de calorías, balances financieros y restricciones de horario se ejecutan mediante código estricto, no mediante alucinaciones de LLM.
- **Capa IA desacoplada:** La IA es opcional y sirve únicamente para captura en lenguaje natural, síntesis conversacional y preparación de propuestas. Jamás escribe directamente en la base canónica ni aprueba acciones sensibles sin confirmación humana.
- **Ciclo Semanal:**
  - *Sábado:* Revisión conversacional de la semana y generación del borrador.
  - *Aprobación:* Generación de una Baseline Inmutable de la semana entrante.
  - *Domingo:* Preparación logística (compras, despensa, batch cooking, pagos).
  - *Lunes a Domingo:* Ejecución trazable (registro de lo realizado vs. lo planeado).

## 2. Mapa de Dominios
1. **Planning & Time:** Gestión de bloques, detección de solapamientos, generación de borrador de agenda, baseline semanal inmutable y registro de desviaciones.
2. **Habits & Personal:** Registro de hábitos diarios, metas a largo plazo, métricas de bienestar y progreso.
3. **Nutrition & Inventory:** Bibliotecas de recetas/ejercicios con datos calóricos/nutricionales, cruce con inventario actual y generación de lista de compras.
4. **Finance:** Presupuesto semanal/mensual, monitoreo de suscripciones, pagos fijos, margen de ahorro e impacto de compras de despensa.
5. **Memory & Knowledge:** Separación estricta entre hechos registrados, preferencias, metas y conocimiento externo (bibliotecas importables en Markdown/JSON).

## 3. Pila Tecnológica Base
- **Runtime:** Node.js (arquitectura modular DDD / Clean Architecture).
- **Persistencia:** SQLite local determinista con transacciones e integridad referencial.
- **Integraciones futuras:** Interfaz de escritorio Kubuntu (estética nocturna/morada sobria) y conector local de inferencia (Ollama/API local).