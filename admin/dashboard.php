<?php
session_start();
if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    header("Location: login.php");
    exit;
}

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

$host = "127.0.0.1";
$username = "u164192416_kreafdemy";
$password = "Yeotan89";
$database = "u164192416_kreafdemy";

// Membuat koneksi
$conn = new mysqli($host, $username, $password, $database);

// Mengecek koneksi
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

// Query SQL untuk mengambil data dari tabel contact_messages
$sql_contact = "SELECT id, name, email, phone, message, contact_date FROM contact_messages";
$result_contact = $conn->query($sql_contact);

// Query SQL untuk mengambil data dari tabel trial_registrations
$sql_trial = "SELECT id, child_name, child_age, parent_name, sales_name, trial_date, trial_time, phone, email, registration_date FROM trial_registrations";
$result_trial = $conn->query($sql_trial);

// Query SQL untuk mengambil data dari tabel users
$sql_users = "SELECT id, username, email, phone FROM users";
$result_users = $conn->query($sql_users);

if (!$result_contact || !$result_trial || !$result_users) {
    die("Query failed: " . $conn->error);
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <meta name="description" content="" />
    <meta name="author" content="" />
    <title>Dashboard - Kreafdemy Admin</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/css/bootstrap.min.css" rel="stylesheet" />
    <link href="css/styles.css" rel="stylesheet" />
    <script src="https://use.fontawesome.com/releases/v6.3.0/js/all.js" crossorigin="anonymous"></script>
    <style>
        body {
            background: linear-gradient(to right, #e0eafc, #cfdef3);
            font-family: 'Arial', sans-serif;
        }
        .table-custom {
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
            border-collapse: separate;
            border-spacing: 0;
            animation: fadeIn 1s ease-in-out;
            background: #ffffff;
        }
        .table-custom thead {
            background: linear-gradient(to right, #007bff, #00c6ff);
            color: #ffffff;
            position: sticky;
            top: 0;
            z-index: 1;
            text-transform: uppercase;
        }
        .table-custom tbody tr {
            transition: background-color 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease;
        }
        .table-custom tbody tr:nth-child(odd) {
            background-color: #f8f9fa;
        }
        .table-custom tbody tr:hover {
            background-color: #e9ecef;
            transform: scale(1.02);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        .table-custom th, .table-custom td {
            padding: 16px;
            text-align: left;
            border: 1px solid #dee2e6;
            vertical-align: middle;
        }
        .table-custom th:first-child, .table-custom td:first-child {
            border-top-left-radius: 10px;
            border-bottom-left-radius: 10px;
        }
        .table-custom th:last-child, .table-custom td:last-child {
            border-top-right-radius: 10px;
            border-bottom-right-radius: 10px;
        }
        .card-header {
            background: linear-gradient(to right, #343a40, #212529);
            color: #ffffff;
            font-weight: bold;
            animation: slideIn 1s ease-out;
            display: flex;
            justify-content: space-between;
            align-items: center;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .card-header .icon {
            animation: pop 0.5s ease-in-out;
        }
        .card-header .icon:hover {
            color: #ffffff;
            transform: scale(1.2);
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideIn {
            from { transform: translateY(-100px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pop {
            0% { transform: scale(0.9); opacity: 0.7; }
            100% { transform: scale(1); opacity: 1; }
        }
        .icon {
            color: #007bff;
            animation: pop 0.5s ease-in-out;
        }
        .icon:hover {
            color: #0056b3;
        }
        .table-wrapper {
            overflow-x: auto;
        }
        .breadcrumb-item.active {
            font-weight: bold;
            color: #343a40;
        }
    </style>
</head>
<body class="sb-nav-fixed">
    <nav class="sb-topnav navbar navbar-expand navbar-dark bg-dark">
        <a class="navbar-brand ps-3" href="dashboard.php">Kreafdemy Admin</a>
        <button class="btn btn-link btn-sm order-1 order-lg-0 me-4 me-lg-0" id="sidebarToggle" href="#!"><i class="fas fa-bars"></i></button>
        <form class="d-none d-md-inline-block form-inline ms-auto me-0 me-md-3 my-2 my-md-0">
            <div class="input-group">
                <input class="form-control" type="text" placeholder="Search for..." aria-label="Search for..." aria-describedby="btnNavbarSearch" />
                <button class="btn btn-primary" id="btnNavbarSearch" type="button"><i class="fas fa-search icon"></i></button>
            </div>
        </form> 
        <ul class="navbar-nav ms-auto ms-md-0 me-3 me-lg-4">
            <li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle" id="navbarDropdown" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false"><i class="fas fa-user fa-fw icon"></i></a>
                <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="navbarDropdown">
                    <li><hr class="dropdown-divider" /></li>
                    <li><a class="dropdown-item" href="logout.php">Logout</a></li>
                </ul>
            </li>
        </ul>
    </nav>
    <div id="layoutSidenav">
        <div id="layoutSidenav_nav">
            <nav class="sb-sidenav accordion sb-sidenav-dark" id="sidenavAccordion">
                <div class="sb-sidenav-menu">
                    <div class="nav">
                        <div class="sb-sidenav-menu-heading">Core</div>
                        <a class="nav-link" href="dashboard.php">
                            <div class="sb-nav-link-icon"><i class="fas fa-tachometer-alt icon"></i></div>
                            Dashboard
                        </a>
                        <div class="sb-sidenav-menu-heading">Interface</div>
                        <a class="nav-link collapsed" href="#" data-bs-toggle="collapse" data-bs-target="#collapseLayouts" aria-expanded="false" aria-controls="collapseLayouts">
                            <div class="sb-nav-link-icon"><i class="fas fa-columns icon"></i></div>
                            Layouts
                            <div class="sb-sidenav-collapse-arrow"><i class="fas fa-angle-down icon"></i></div>
                        </a>
                        <div class="collapse" id="collapseLayouts" aria-labelledby="headingOne" data-bs-parent="#sidenavAccordion">
                            <nav class="sb-sidenav-menu-nested nav">
                                <a class="nav-link" href="#">Static Navigation</a>
                                <a class="nav-link" href="#">Light Sidenav</a>
                            </nav>
                        </div>
                        <a class="nav-link collapsed" href="#" data-bs-toggle="collapse" data-bs-target="#collapsePages" aria-expanded="false" aria-controls="collapsePages">
                            <div class="sb-nav-link-icon"><i class="fas fa-book-open icon"></i></div>
                            Pages
                            <div class="sb-sidenav-collapse-arrow"><i class="fas fa-angle-down icon"></i></div>
                        </a>
                        <div class="collapse" id="collapsePages" aria-labelledby="headingTwo" data-bs-parent="#sidenavAccordion">
                            <nav class="sb-sidenav-menu-nested nav accordion" id="sidenavAccordionPages">
                                <a class="nav-link" href="#">Revenue Sales</a>
                                <a class="nav-link" href="#">Contact Parent</a>
                            </nav>
                        </div>
                        <div class="sb-sidenav-menu-heading">Addons</div>
                        <a class="nav-link" href="#">
                            <div class="sb-nav-link-icon"><i class="fas fa-chart-area icon"></i></div>
                            Charts
                        </a>
                        <a class="nav-link" href="#">
                            <div class="sb-nav-link-icon"><i class="fas fa-table icon"></i></div>
                            Tables
                        </a>
                    </div>
                </div>
                <div class="sb-sidenav-footer">
                    <div class="small">Logged in as:</div>
                    Kreafdemy
                </div>
            </nav>
        </div>
        <div id="layoutSidenav_content">
            <main>
                <div class="container-fluid px-4">
                    <h1 class="mt-4">Dashboard</h1>
                    <ol class="breadcrumb mb-4">
                        <li class="breadcrumb-item active">Dashboard</li>
                    </ol>

                    <!-- Contact Messages Table -->
                    <div class="card mb-4">
                        <div class="card-header">
                            <i class="fas fa-envelope icon"></i>
                            Contact Messages
                        </div>
                        <div class="card-body table-wrapper">
                            <table id="datatablesSimple" class="table table-striped table-custom">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Name</th>
                                        <th>Email</th>
                                        <th>Phone</th>
                                        <th>Message</th>
                                        <th>Date Sent</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php
                                    if ($result_contact->num_rows > 0) {
                                        while ($row = $result_contact->fetch_assoc()) {
                                            echo "<tr>";
                                            echo "<td>" . $row["id"] . "</td>";
                                            echo "<td>" . $row["name"] . "</td>";
                                            echo "<td>" . $row["email"] . "</td>";
                                            echo "<td>" . $row["phone"] . "</td>";
                                            echo "<td>" . $row["message"] . "</td>";
                                            echo "<td>" . $row["contact_date"] . "</td>";
                                            echo "</tr>";
                                        }
                                    } else {
                                        echo "<tr><td colspan='6'>No results found</td></tr>";
                                    }
                                    ?>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Trial Registrations Table -->
                    <div class="card mb-4">
                        <div class="card-header">
                            <i class="fas fa-users icon"></i>
                            Trial Registrations
                        </div>
                        <div class="card-body table-wrapper">
                            <table id="datatablesSimple2" class="table table-striped table-custom">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Child Name</th>
                                        <th>Child Age</th>
                                        <th>Parent Name</th>
                                        <th>Sales Name</th>
                                        <th>Trial Date</th>
                                        <th>Trial Time</th>
                                        <th>Phone</th>
                                        <th>Email</th>
                                        <th>Registration Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php
                                    if ($result_trial->num_rows > 0) {
                                        while ($row = $result_trial->fetch_assoc()) {
                                            echo "<tr>";
                                            echo "<td>" . $row["id"] . "</td>";
                                            echo "<td>" . $row["child_name"] . "</td>";
                                            echo "<td>" . $row["child_age"] . "</td>";
                                            echo "<td>" . $row["parent_name"] . "</td>";
                                            echo "<td>" . $row["sales_name"] . "</td>";
                                            echo "<td>" . $row["trial_date"] . "</td>";
                                            echo "<td>" . $row["trial_time"] . "</td>";
                                            echo "<td>" . $row["phone"] . "</td>";
                                            echo "<td>" . $row["email"] . "</td>";
                                            echo "<td>" . $row["registration_date"] . "</td>";
                                            echo "</tr>";
                                        }
                                    } else {
                                        echo "<tr><td colspan='10'>No results found</td></tr>";
                                    }
                                    ?>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Users Table -->
                    <div class="card mb-4">
                        <div class="card-header">
                            <i class="fas fa-user icon"></i>
                            Users
                        </div>
                        <div class="card-body table-wrapper">
                            <table id="datatablesSimple3" class="table table-striped table-custom">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Username</th>
                                        <th>Email</th>
                                        <th>Phone</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php
                                    if ($result_users->num_rows > 0) {
                                        while ($row = $result_users->fetch_assoc()) {
                                            echo "<tr>";
                                            echo "<td>" . $row["id"] . "</td>";
                                            echo "<td>" . $row["username"] . "</td>";
                                            echo "<td>" . $row["email"] . "</td>";
                                            echo "<td>" . $row["phone"] . "</td>";
                                            echo "</tr>";
                                        }
                                    } else {
                                        echo "<tr><td colspan='4'>No results found</td></tr>";
                                    }
                                    $conn->close();
                                    ?>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </main>
            <footer class="py-4 bg-light mt-auto">
                <div class="container-fluid px-4">
                    <div class="d-flex align-items-center justify-content-between small">
                        <div class="text-muted">Copyright &copy; Kreafdemy</div>
                        <div>
                            <a href="#">Privacy Policy</a>
                            &middot;
                            <a href="#">Terms &amp; Conditions</a>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/js/bootstrap.bundle.min.js" crossorigin="anonymous"></script>
    <script src="js/scripts.js"></script>
</body>
</html>
