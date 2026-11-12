package app.backend.userlogin;

import java.util.ArrayList;

public class userservice {

    rivate ArrayList<User> users = new ArrayList<>();

    // Registration
    public boolean register(String username, String password, String email) {

        // Check existing username
        for (User user : users) {
            if (user.getUsername().equalsIgnoreCase(username)) {
                System.out.println("Username already exists!");
                return false;
            }
        }

        // Create new user object
        User newUser = new User(username, password, email);

        users.add(newUser);

        System.out.println("Registration successful!");

        return true;
    }

    // Login
    public boolean login(String username, String password) {

        for (User user : users) {

            if (user.getUsername().equalsIgnoreCase(username)) {

                if (user.verifyPassword(password)) {
                    System.out.println("Login successful!");
                    System.out.println("Welcome, " + user.getUsername());
                    return true;
                }
            }
        }

        System.out.println("Invalid username or password!");
        return false;
    }

    // Display registered users
    public void displayUsers() {

        System.out.println("\nRegistered Users:");

        for (User user : users) {
            System.out.println("Username: " + user.getUsername());
            System.out.println("Email: " + user.getEmail());
            System.out.println("------------------");
        }
    }

    
}
