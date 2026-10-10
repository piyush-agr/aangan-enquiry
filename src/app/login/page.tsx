import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="login">
      <div className="panel">
        <h1 style={{ marginBottom: 4 }}>Aangan Studio</h1>
        <p className="muted">Sign in to see phone enquiries.</p>
        <LoginForm />
      </div>
    </div>
  );
}
