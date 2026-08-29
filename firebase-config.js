// 1) Pegá acá la configuración de TU proyecto de Firebase.
// La sacás de: Firebase Console > (icono de engranaje) Configuración del proyecto
// > pestaña "General" > sección "Tus apps" > app web > "SDK de Firebase".
// Este archivo NO es secreto: estos valores identifican tu proyecto, pero no dan
// acceso por sí solos. Quien protege los datos son las reglas de firestore.rules.
const firebaseConfig = {
  apiKey: "AIzaSyDKWrRKZXvgXc7eaCNKU7C6lv_bgu9Kyp4",
  authDomain: "gastos-compartidos-2cee3.firebaseapp.com",
  projectId: "gastos-compartidos-2cee3",
  storageBucket: "gastos-compartidos-2cee3.firebasestorage.app",
  messagingSenderId: "725059340348",
  appId: "1:725059340348:web:b5a8a9dadbdb3f9bfddb39"
};

// 2) Completá acá las dos cuentas de Google que pueden entrar a la app.
// Tienen que ser exactamente los mismos emails que vas a poner en firestore.rules.
const ALLOWED_EMAILS = [
  "fernandotonini11@gmail.com",
  "lic.angelesfernandez@gmail.com"
];
