/* =====================================================================
 *  Firebase の設定
 *  Firebase コンソール →（歯車）プロジェクトの設定 → マイアプリ（ウェブアプリ）
 *  に表示される firebaseConfig をここに貼り付けてください。
 *  ※ databaseURL（Realtime Database の URL）が必須です。
 *  null のままだと「オフラインモード」（ひとり用・この端末にだけ保存）で動きます。
 *
 *  ※ この値は公開されても問題ない設計です（データは database.rules.json で守ります）。
 * ===================================================================== */
window.FIREBASE_CONFIG = null;

/* 例：
window.FIREBASE_CONFIG = {
  apiKey: "AIza...........................",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};
*/
