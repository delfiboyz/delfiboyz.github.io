<?php
$servername = "localhost";
$username = "u164192416_kreafdemy";
$password = "Yeotan89";
$dbname = "u164192416_kreafdemy";

// Buat koneksi
$conn = new mysqli($servername, $username, $password, $dbname);

// Cek koneksi
if ($conn->connect_error) {
    die("Koneksi gagal: " . $conn->connect_error);
}

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    $name = $_POST['name'];
    $email = $_POST['email'];
    $phone = $_POST['phone'];
    $class = $_POST['class'];

    // Validasi dan upload file
    if (isset($_FILES['screenshot']) && $_FILES['screenshot']['error'] == 0) {
        $allowed = ['jpg', 'jpeg', 'png', 'gif'];
        $filename = $_FILES['screenshot']['name'];
        $filetmp = $_FILES['screenshot']['tmp_name'];
        $filesize = $_FILES['screenshot']['size'];
        $filetype = pathinfo($filename, PATHINFO_EXTENSION);

        if (in_array($filetype, $allowed)) {
            // Tambahkan timestamp ke nama file untuk memastikan nama file unik
            $new_filename = time() . "_" . uniqid() . "." . $filetype;
            $upload_dir = 'uploads/';
            $filepath = $upload_dir . basename($new_filename);

            if (move_uploaded_file($filetmp, $filepath)) {
                $sql = "INSERT INTO payments (name, email, phone, class, screenshot_path) 
                        VALUES ('$name', '$email', '$phone', '$class', '$filepath')";

                if ($conn->query($sql) === TRUE) {
                    echo '<div class="alert alert-success">Data berhasil disimpan.</div>';
                } else {
                    echo '<div class="alert alert-danger">Error: ' . $sql . '<br>' . $conn->error . '</div>';
                }
            } else {
                echo '<div class="alert alert-danger">Gagal mengupload file.</div>';
            }
        } else {
            echo '<div class="alert alert-danger">Format file tidak diizinkan. Hanya jpg, jpeg, png, dan gif yang diperbolehkan.</div>';
        }
    } else {
        echo '<div class="alert alert-danger">Silahkan pilih file untuk diunggah.</div>';
    }
} else {
    echo '<div class="alert alert-danger">Metode permintaan tidak valid.</div>';
}

$conn->close();
?>
