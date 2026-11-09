// This component is for Footer to use everywhere in the app
export default function Footer() {
    return(
        <footer className="bg-gray-900 px-6 py-4 mt-auto">
            <p>Home</p>
            <p>About</p>
            <p>Blog</p>
            <p className="text-center text-white">
               <p1>Powerded By Wrool IT Solutions</p1> &copy; {new Date().getFullYear()} Wrool-AI. All rights reserved.
            </p>
        </footer>
    )
}