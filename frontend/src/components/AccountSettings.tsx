import { useState } from "react";
import "./AccountSettings.css";

type Props = {
  user?: {
    name: string;
    email: string;
  };
  onSave?: (data: Record<string, unknown>) => Promise<void>;
};

export default function AccountSettings({ user, onSave }: Props) {
  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    password: "",
    notifications: true,
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleChange = (key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setMessage(null);

    try {
      await onSave?.(form);
      setMessage("Settings saved successfully");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="settings-container">
      <h2>Account Settings</h2>

      {/* Profile Section */}
      <div className="settings-section">
        <h3>Profile</h3>

        <label>
          Name
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleChange("name", e.target.value)}
          />
        </label>

        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => handleChange("email", e.target.value)}
          />
        </label>
      </div>

      {/* Password Section */}
      <div className="settings-section">
        <h3>Security</h3>

        <label>
          New Password
          <input
            type="password"
            value={form.password}
            onChange={(e) => handleChange("password", e.target.value)}
          />
        </label>
      </div>

      {/* Preferences */}
      <div className="settings-section">
        <h3>Preferences</h3>

        <label className="toggle">
          <input
            type="checkbox"
            checked={form.notifications}
            onChange={(e) =>
              handleChange("notifications", e.target.checked)
            }
          />
          Enable Notifications
        </label>
      </div>

      {/* Feedback */}
      {message && <p className="settings-message">{message}</p>}

      {/* Actions */}
      <button
        className="settings-save-btn"
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}