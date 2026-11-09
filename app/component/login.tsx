import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
    const router = useRouter();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    // Assining the Value and Create or element
    async function login(e: FormEvent<HTMLFormElement>) {
        event?.preventDefault();
        setError("");
        setLoading(true);

        const form = new FormData(event?.currentTarget);

        // exporat the route and API interigation or GET,POST,PUT,DELETE etc.

        try {
            const response = await fetch("/api/auth/login", {

                method: "POST",

                headers: {

                    "Content-Type": "application/x-www-form-urlencoded",

                },

                body: new URLSearchParams({

                    email: String(form.get("email") ?? ""),

                    password: String(form.get("password") ?? ""),

                }),

            });



            const data = await response.json();



            if (!response.ok) {

                setError(data.error ?? "Login failed.");

                return;

            }



            router.replace("/dashboard");

            router.refresh();

        } catch {

            setError("Unable to connect. Please try again.");

        } finally {

            setLoading(false);

        }

    }



    return (

        <main

            style={{

                minHeight: "100vh",

                display: "grid",

                placeItems: "center",

                background: "linear-gradient(135deg, #eff6ff, #e0e7ff)",

                padding: 24,

                fontFamily: "Arial, sans-serif",

            }}

        >

            <form

                onSubmit={login}

                style={{

                    width: "100%",

                    maxWidth: 400,

                    padding: 32,

                    borderRadius: 20,

                    background: "#fff",

                    color: "#0f172a",

                    boxShadow: "0 20px 60px rgba(15,23,42,.12)",

                    display: "grid",

                    gap: 16,

                }}

            >

                <div>

                    <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>

                        Welcome back

                    </h1>

                    <p style={{ margin: 0, color: "#64748b" }}>

                        Sign in to your account

                    </p>

                </div>



                <label htmlFor="email">Email address</label>

                <input

                    id="email"

                    name="email"

                    type="email"

                    required

                    maxLength={254}

                    autoComplete="username"

                    placeholder="you@example.com"

                    style={inputStyle}

                />



                <label htmlFor="password">Password</label>

                <input

                    id="password"

                    name="password"

                    type="password"

                    required

                    maxLength={1024}

                    autoComplete="current-password"

                    placeholder="Enter your password"

                    style={inputStyle}

                />



                {error && (

                    <p role="alert" style={{ margin: 0, color: "#dc2626" }}>

                        {error}

                    </p>

                )}



                <button

                    type="submit"

                    disabled={loading}

                    style={{

                        border: 0,

                        borderRadius: 10,

                        padding: 14,

                        background: loading ? "#94a3b8" : "#2563eb",

                        color: "#fff",

                        fontSize: 16,

                        cursor: loading ? "wait" : "pointer",

                    }}

                >

                    {loading ? "Signing in..." : "Sign in"}

                </button>

            </form>

        </main>

    );

}



const inputStyle = {

    width: "100%",

    boxSizing: "border-box" as const,

    border: "1px solid #cbd5e1",

    borderRadius: 10,

    padding: 12,

    fontSize: 16,

    background: "#fff",

    color: "#0f172a",

};
