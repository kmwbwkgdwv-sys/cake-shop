/* =====================================================================
 *  Firebase の設定
 *  Firebase コンソール →（歯車）プロジェクトの設定 → マイアプリ（ウェブアプリ）
 *  に表示される firebaseConfig の値をここに入れます。
 *  ※ databaseURL（Realtime Database の URL）と projectId が必須です。
 *     まだ空のあいだは「オフラインモード」（ひとり用・この端末にだけ保存）で動きます。
 *
 *  ※ この値は公開されても問題ない設計です（データは database.rules.json で守ります）。
 * ===================================================================== */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyD8CK3jDMzfD2AkeEKq-ndRZsxjSIuzxJ0",
  // ↓ ここから下は Firebase コンソールの firebaseConfig の値を入れてください
  authDomain: "",        // 例: "your-project.firebaseapp.com"
  databaseURL: "",       // 例: "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app"
  projectId: "",         // 例: "your-project"
  storageBucket: "",     // 例: "your-project.appspot.com"
  messagingSenderId: "", // 例: "000000000000"
  appId: "",             // 例: "1:000000000000:web:0000000000000000"
};
