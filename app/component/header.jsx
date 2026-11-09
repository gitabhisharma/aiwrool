
// import "./globals.css";

// This is a client component and will be rendered on the client side or everywhere. It can use
export default function header(){

    // This is Header to use everywhere in the app
    return(
        <>
        <div className="bg-gray-900 px-6 py-4 mt-auto text-center">
           <li classname = "navbar"><a>Home</a></li>
           <li classname = "navbar"><a>About</a></li>
           <li classname = "navbar"><a>Blog</a></li>
           <li classname = "navbar"><a>Upgrade-Pro</a></li>
           <li classname = "sing_page"><a>Sing</a></li>
        </div>
        </>
    )



}