package app.backend.userlogin;

import java.util.Scanner;

public class main {

    public static void main(String[] args) {

        Scanner sc = new Scanner(System.in);

        UserService service = new UserService();

        while (true) {

            System.out.println("\n===== USER REGISTRATION SYSTEM =====");
            System.out.println("1. Register");
            System.out.println("2. Login");
            System.out.println("3. Display Users");
            System.out.println("4. Exit");

            System.out.print("Enter your choice: ");
            int choice = Integer.parseInt(sc.nextLine());

            switch (choice) {

                case 1:

                    System.out.print("Enter Username: ");
                    String username = sc.nextLine();

                    System.out.print("Enter Password: ");
                    String password = sc.nextLine();

                    System.out.print("Enter Email: ");
                    String email = sc.nextLine();

                    service.register(username, password, email);

                    break;

                case 2:

                    System.out.print("Enter Username: ");
                    String loginUsername = sc.nextLine();

                    System.out.print("Enter Password: ");
                    String loginPassword = sc.nextLine();

                    service.login(loginUsername, loginPassword);

                    break;

                case 3:

                    service.displayUsers();

                    break;

                case 4:

                    System.out.println("Thank you!");
                    sc.close();
                    return;

                default:

                    System.out.println("Invalid choice!");
            }
        }
    }

    
}
