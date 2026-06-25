"use client";

import { useState } from "react";
import { Input } from "../Input";

export function SettingsView() {
  const [alias, setAlias] = useState("");
  const [email, setEmail] = useState("");
  const [notifications, setNotifications] = useState(true);

  return (
    <div className="max-w-lg mx-auto py-8 space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">Profile</h2>
        <div className="space-y-4">
          <Input label="Wallet Address" value="G...xxxx" disabled />
          <Input label="Alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button
            onClick={() => alert("Profile saved!")}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Save Profile
          </button>
        </div>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-4">Preferences</h2>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
            className="h-5 w-5"
          />
          <span>Email notifications</span>
        </label>
      </section>
    </div>
  );
}
